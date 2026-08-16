from pathlib import Path
import json
import re


ROOT = Path(__file__).resolve().parents[1]


def test_launch_surfaces_use_translation_keys():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    source = (ROOT / "src/main.ts").read_text(encoding="utf-8")

    wired_html = [
        'data-i18n="launch.whatSeeing">What am I seeing?<',
        'data-i18n="launch.happeningNow">Happening now<',
        'data-i18n="launch.shareExport">Share and export<',
        'data-i18n="launch.shareView">Share this view<',
        'data-i18n="launch.copyEmbed">Copy embed<',
        'data-i18n="launch.downloadImage">Download image<',
        'data-i18n="launch.exploreMap">Explore this map<',
        'data-i18n="launch.aboutCredits">About · data credits<',
        'data-i18n="launch.byFerdev">By Ferdev<',
    ]
    for text in wired_html:
        assert text in html, f"launch fallback is missing its data-i18n contract: {text}"

    hardcoded_source = [
        "<span>Sky tonight</span>", 'button.textContent = "Citation copied"',
        "<dt>Source objects</dt>", ">Read methodology</a>",
    ]
    for text in hardcoded_source:
        assert text not in source, f"dynamic launch string bypasses t(): {text}"


def test_every_launch_key_has_a_translation_contract():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    source = (ROOT / "src/main.ts").read_text(encoding="utf-8")
    i18n = (ROOT / "src/i18n.ts").read_text(encoding="utf-8")
    import re

    keys = set(re.findall(r'(?:data-i18n(?:-attrs)?="[^"]*launch\.|t\("launch\.)([A-Za-z0-9]+)', html + source))
    assert keys
    for key in keys:
        assert f'"launch.{key}"' in i18n, f"missing launch translation contract: launch.{key}"


def test_every_advertised_locale_has_real_launch_copy():
    i18n = (ROOT / "src/i18n.ts").read_text(encoding="utf-8")
    source = (ROOT / "src/launchTranslations.ts").read_text(encoding="utf-8")
    payload = json.loads(source[source.index("{"):].rstrip().removesuffix(";"))
    english = {
        key: json.loads(f'"{value}"')
        for key, value in re.findall(r'"(launch\.[^"]+)":"((?:[^"\\]|\\.)*)"', i18n[:i18n.index("const PARTIAL_TRANSLATIONS")])
    }
    assert set(payload) == {"es", "fr", "de", "pt-BR", "it", "zh-Hans", "ja", "ko"}
    for locale, strings in payload.items():
        assert set(strings) == set(english), f"{locale} launch keys differ from English contract"
        for key, translated in strings.items():
            assert translated.strip()
            assert translated.casefold() != english[key].casefold(), f"{locale} falls back to English for {key}"
            assert set(re.findall(r"{(\w+)}", translated)) == set(re.findall(r"{(\w+)}", english[key])), f"{locale} placeholders differ for {key}"
