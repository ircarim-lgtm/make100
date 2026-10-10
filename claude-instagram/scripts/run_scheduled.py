"""
run_scheduled.py - Publica os posts do calendar.json cujo horario ja chegou.

Roda a cada 15 minutos pelo GitHub Actions. Regras:
  - publica o post se publish_at <= agora e ainda nao consta em published.json;
  - se o horario passou ha mais de MAX_LATE_HOURS, NAO publica (evita post fora de hora)
    e avisa com erro, para voce ver no GitHub;
  - cada post publicado e registrado em published.json logo em seguida.
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import publish_instagram as ig

ROOT = Path(__file__).resolve().parent.parent
CALENDAR = ROOT / "calendar.json"
PUBLISHED = ROOT / "published.json"
MAX_LATE = timedelta(hours=float(os.getenv("MAX_LATE_HOURS", "6")))


def load(path: Path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def now_utc() -> datetime:
    override = os.getenv("FAKE_NOW")  # so para testes
    if override:
        return datetime.fromisoformat(override).astimezone(timezone.utc)
    return datetime.now(timezone.utc)


def due_posts(calendar: list, published: dict, now: datetime):
    """Devolve (para_publicar, perdidos)."""
    to_publish, missed = [], []
    for post in sorted(calendar, key=lambda p: p["publish_at"]):
        if post["id"] in published:
            continue
        when = datetime.fromisoformat(post["publish_at"])
        if now < when:
            continue
        (missed if now - when > MAX_LATE else to_publish).append(post)
    return to_publish, missed


def main() -> int:
    dry_run = os.getenv("DRY_RUN", "false").lower() == "true"
    calendar = load(CALENDAR, [])
    published = load(PUBLISHED, {})
    now = now_utc()
    print(f"Agora (UTC): {now.isoformat()}  |  dry_run={dry_run}")

    to_publish, missed = due_posts(calendar, published, now)
    for post in missed:
        print(f"::error::Post {post['id']} passou do horario ({post['publish_at']}) por mais "
              f"de {MAX_LATE} e NAO foi publicado. Publique manualmente ou ajuste o calendario.")
    if not to_publish:
        print("Nenhum post para publicar agora.")
        return 1 if missed else 0

    for post in to_publish:
        print(f"\n=== Publicando {post['id']}: {post['title']} ===")
        video = str(ROOT / post["video"])
        if dry_run:
            ig.run_video(video, post["caption"], dry_run=True)
            continue
        ig.check_credentials()
        url = ig.host_file(video)
        creation_id = ig.publish_reel(url, post["caption"])
        post_id = ig.media_publish(creation_id)
        published[post["id"]] = {
            "post_id": post_id,
            "published_at": datetime.now(timezone.utc).isoformat(),
        }
        PUBLISHED.write_text(json.dumps(published, indent=2) + "\n", encoding="utf-8")
        print(f"Publicado! Post ID: {post_id}")
    return 1 if missed else 0


if __name__ == "__main__":
    sys.exit(main())
