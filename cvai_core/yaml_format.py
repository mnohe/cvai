from __future__ import annotations

import yaml


class CVAIYamlDumper(yaml.SafeDumper):
    # PyYAML's default style is valid YAML but often unpleasant for humans: long
    # multiline values can become single-quoted scalars with embedded blank lines.
    # CVAI data is meant to be edited and reviewed by people, so multiline strings
    # are emitted as literal block scalars (`|`) instead.
    def ignore_aliases(self, data):
        return True


def _represent_string(dumper: yaml.SafeDumper, value: str) -> yaml.nodes.ScalarNode:
    style = "|" if "\n" in value else None
    return dumper.represent_scalar("tag:yaml.org,2002:str", value, style=style)


CVAIYamlDumper.add_representer(str, _represent_string)


def dump_yaml(payload: dict) -> str:
    """Serialize CVAI YAML in the human-readable house style."""
    return yaml.dump(payload, Dumper=CVAIYamlDumper, sort_keys=False, allow_unicode=True)
