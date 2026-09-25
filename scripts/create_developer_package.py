"""Crea un pacchetto condivisibile senza i database e le cache locali."""

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "dist" / "Mockup_Budget_Analitico_Wingest_sviluppatore.zip"
FILES = (
    ".gitignore",
    ".vscode/tasks.json",
    "README.md",
    "docs/ARCHITETTURA_DATABASE.md",
    "docs/SPECIFICA_SVILUPPATORE_BUDGET_WINGEST.md",
    "index.html",
    "query_esempio.sql",
    "schema.sql",
    "schema_normalizzato.sql",
    "server.py",
    "start.bat",
    "scripts/__init__.py",
    "scripts/create_developer_package.py",
    "scripts/init_normalized_db.py",
    "tests/capex-plan.test.mjs",
)


def main() -> None:
    sources = [ROOT / relative for relative in FILES]
    sources.extend(path for path in (ROOT / "assets").rglob("*") if path.is_file())
    missing = [str(path) for path in sources if not path.is_file()]
    if missing:
        raise FileNotFoundError(f"File mancanti dal pacchetto: {', '.join(missing)}")

    OUTPUT.parent.mkdir(exist_ok=True)
    with ZipFile(OUTPUT, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        archive.writestr(f"{ROOT.name}/data/", "")
        for source in sorted(sources):
            relative = source.relative_to(ROOT)
            archive.write(source, arcname=f"{ROOT.name}/{relative.as_posix()}")
    print(f"Pacchetto creato: {OUTPUT}")
    print(f"File inclusi: {len(sources)}; database locali esclusi")


if __name__ == "__main__":
    main()
