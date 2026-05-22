from __future__ import annotations

import argparse
from pathlib import Path

from cvai_core.schema import assert_valid_data_root, format_issues, initialize_data_root, validate_data_root
from cvai_core.templates import import_template_pack


def main() -> int:
    parser = argparse.ArgumentParser(prog="cvai", description="Run CVAI or manage a CVAI data directory.")
    subcommands = parser.add_subparsers(dest="command")

    subcommands.add_parser("serve", help="run the web server")

    init_parser = subcommands.add_parser("init", help="create a new empty CVAI data directory")
    init_parser.add_argument("data_root", type=Path)

    validate_parser = subcommands.add_parser("validate", help="validate a CVAI data directory")
    validate_parser.add_argument("data_root", type=Path)

    templates_parser = subcommands.add_parser("templates", help="manage CVAI PDF templates")
    templates_subcommands = templates_parser.add_subparsers(dest="templates_command")
    import_parser = templates_subcommands.add_parser("import", help="copy a template pack into a data directory")
    import_parser.add_argument("source", type=Path)
    import_parser.add_argument("data_root", type=Path)
    import_parser.add_argument("--replace", action="store_true", help="replace an existing template with the same id")

    args = parser.parse_args()
    if args.command == "init":
        created = initialize_data_root(args.data_root)
        assert_valid_data_root(args.data_root)
        print(f"{args.data_root}: initialized ({len(created)} new path(s))")
        return 0
    if args.command == "validate":
        issues = validate_data_root(args.data_root)
        if issues:
            print(format_issues(issues))
            return 1
        print(f"{args.data_root}: schema validation passed")
        return 0
    if args.command == "templates" and args.templates_command == "import":
        destination = import_template_pack(args.source, args.data_root, replace=args.replace)
        print(f"Imported template into {destination}")
        return 0
    if args.command == "templates":
        parser.error("templates requires a subcommand")

    from .asgi import main as asgi_main

    asgi_main()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
