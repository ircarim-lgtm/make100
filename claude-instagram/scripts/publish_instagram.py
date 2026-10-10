"""
publish_instagram.py - Publica fotos e carrosseis no Instagram
via API do Instagram com login do Instagram (graph.instagram.com).

Uso:
  python publish_instagram.py --test
  python publish_instagram.py --images slide1.png slide2.png --caption "Legenda" --dry-run
  python publish_instagram.py --images slide1.png slide2.png --caption "Legenda"
"""
import argparse
import os
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

# Procura o .env na pasta do script, na pasta de cima e na pasta atual
HERE = Path(__file__).resolve().parent
for candidate in (HERE / ".env", HERE.parent / ".env", Path.cwd() / ".env"):
    if candidate.exists():
        load_dotenv(candidate)
        break

IG_ID = os.getenv("INSTAGRAM_BUSINESS_ID")
TOKEN = os.getenv("INSTAGRAM_ACCESS_TOKEN")
BASE_URL = f"https://graph.instagram.com/{os.getenv('META_API_VERSION', 'v21.0')}"


def fail(msg: str):
    print(f"ERRO: {msg}")
    sys.exit(1)


def check_credentials():
    if not IG_ID or not TOKEN:
        fail("Credenciais nao encontradas. Preencha o arquivo .env (veja .env.example).")


def api(method: str, path: str, **kwargs) -> dict:
    kwargs.setdefault("timeout", 60)
    resp = requests.request(method, f"{BASE_URL}/{path}", **kwargs)
    try:
        data = resp.json()
    except ValueError:
        fail(f"Resposta inesperada da API: {resp.text[:200]}")
    if "error" in data:
        err = data["error"]
        fail(f"{err.get('message')} (codigo {err.get('code')})")
    return data


def test_connection():
    check_credentials()
    data = api("GET", "me", params={
        "fields": "user_id,username,name,account_type",
        "access_token": TOKEN,
    })
    print("Conexao OK!")
    print(f"  Conta:  @{data.get('username')}")
    print(f"  Nome:   {data.get('name')}")
    print(f"  Tipo:   {data.get('account_type')}")
    print(f"  ID:     {data.get('user_id') or data.get('id')}")


def host_image(image_path: str) -> str:
    """Hospeda imagem ou video em uma URL publica (a API exige URL, nao arquivo)."""
    path = Path(image_path)
    if not path.exists():
        fail(f"Arquivo nao encontrado: {image_path}")
    last = ""
    for attempt in range(1, 4):
        try:
            with open(path, "rb") as f:
                resp = requests.post(
                    "https://catbox.moe/user/api.php",
                    data={"reqtype": "fileupload"},
                    files={"fileToUpload": (path.name, f)},
                    timeout=180,
                )
            last = resp.text.strip()
            if last.startswith("https://"):
                print(f"  Hospedada: {last}")
                return last
        except requests.RequestException as exc:
            last = str(exc)
        print(f"  Tentativa {attempt}/3 de hospedagem falhou: {last[:100]}")
        time.sleep(5 * attempt)
    fail(f"Falha ao hospedar o arquivo: {last}")


host_file = host_image


def wait_ready(container_id: str, tries: int = 24):
    for i in range(tries):
        data = api("GET", container_id, params={
            "fields": "status_code",
            "access_token": TOKEN,
        })
        status = data.get("status_code", "")
        if status == "FINISHED":
            return
        if status in ("ERROR", "EXPIRED"):
            fail(f"Container com status {status}: {data}")
        print(f"  Processando... {i * 5}s")
        time.sleep(5)
    fail("Tempo esgotado esperando o Instagram processar a midia.")


def publish_reel(video_url: str, caption: str) -> str:
    """Cria o container de Reels e espera o Instagram processar o video."""
    data = api("POST", f"{IG_ID}/media", data={
        "media_type": "REELS",
        "video_url": video_url,
        "caption": caption,
        "share_to_feed": "true",
        "access_token": TOKEN,
    })
    wait_ready(data["id"], tries=60)
    return data["id"]


def media_publish(creation_id: str) -> str:
    post = api("POST", f"{IG_ID}/media_publish", data={
        "creation_id": creation_id,
        "access_token": TOKEN,
    })
    return post["id"]


def publish_single(image_url: str, caption: str) -> str:
    data = api("POST", f"{IG_ID}/media", data={
        "image_url": image_url,
        "caption": caption,
        "access_token": TOKEN,
    })
    wait_ready(data["id"])
    return data["id"]


def publish_carousel(image_urls: list, caption: str) -> str:
    children = []
    for url in image_urls:
        item = api("POST", f"{IG_ID}/media", data={
            "image_url": url,
            "is_carousel_item": "true",
            "access_token": TOKEN,
        })
        print(f"  Item: {item['id']}")
        children.append(item["id"])
    for child in children:
        wait_ready(child)
    carousel = api("POST", f"{IG_ID}/media", data={
        "media_type": "CAROUSEL",
        "children": ",".join(children),
        "caption": caption,
        "access_token": TOKEN,
    })
    wait_ready(carousel["id"])
    return carousel["id"]


def run(images: list, caption: str, dry_run: bool):
    check_credentials()
    if not 1 <= len(images) <= 10:
        fail("Envie de 1 a 10 imagens.")
    for img in images:
        if not Path(img).exists():
            fail(f"Arquivo nao encontrado: {img}")

    kind = "carrossel" if len(images) > 1 else "foto"
    print(f"\nPublicando {kind} com {len(images)} imagem(ns)...")
    if dry_run:
        print("[DRY RUN] Tudo certo. Remova --dry-run para publicar de verdade.")
        return

    print("\nPasso 1: hospedando imagens...")
    urls = [host_image(img) for img in images]

    print("\nPasso 2: criando a midia no Instagram...")
    creation_id = (
        publish_carousel(urls, caption) if len(urls) > 1 else publish_single(urls[0], caption)
    )

    print("\nPasso 3: publicando...")
    print(f"\nPublicado com sucesso! Post ID: {media_publish(creation_id)}")


def run_video(video: str, caption: str, dry_run: bool):
    check_credentials()
    if not Path(video).exists():
        fail(f"Arquivo nao encontrado: {video}")
    print("\nPublicando Reels...")
    if dry_run:
        print("[DRY RUN] Tudo certo. Remova --dry-run para publicar de verdade.")
        return
    print("\nPasso 1: hospedando o video...")
    url = host_file(video)
    print("\nPasso 2: o Instagram esta processando o video...")
    creation_id = publish_reel(url, caption)
    print("\nPasso 3: publicando...")
    print(f"\nPublicado com sucesso! Post ID: {media_publish(creation_id)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Publica no Instagram")
    parser.add_argument("--test", action="store_true", help="Testa a conexao e sai")
    parser.add_argument("--images", nargs="+", help="Caminhos das imagens (1 a 10)")
    parser.add_argument("--video", help="Caminho de um video (publicado como Reels)")
    parser.add_argument("--caption", default="", help="Legenda do post")
    parser.add_argument("--dry-run", action="store_true", help="Valida sem publicar")
    args = parser.parse_args()

    if args.test:
        test_connection()
    elif args.video:
        run_video(args.video, args.caption, args.dry_run)
    elif args.images:
        run(args.images, args.caption, args.dry_run)
    else:
        parser.error("Use --test, --video ou --images ...")
