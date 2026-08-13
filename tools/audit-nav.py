#!/usr/bin/env python3
"""Audit of the navigation and footer links across the language variants.

For every <a> inside a <nav> or a <footer>, two independent things are
checked against the English page of the same family:

  LABEL  the wording must differ from the English one, unless the term is
         deliberately identical in every language
  HREF   the target must belong to the page's own language

Language codes are derived from the file names, never assumed. The language
bar and the language switcher are excluded: crossing languages is their
purpose.

Run from the repository root. The exit status is the number of
non-conforming rows, so the script can gate a commit.
"""

import collections
import glob
import os
import re
import sys

# Terms that are the same in every language and are not translation debt.
ALLOW_ANY = {
    'human flag', 'hf signal 01', 'paper i', 'paper ii', 'paper iii',
    'ccw', 'gge', 'laws', 'doi', 'ssrn', 'zenodo', 'corpus guide',
}

# Wording that legitimately coincides with the English in one language only.
ALLOW_BY_LANG = {
    'fr': {'contact'},        # written the same way in French
    'it': {'home'},           # the Association's chosen form for ← Home
}

# Pages published in English only, by choice; every language links to them.
MONOLINGUAL = {'statement.html'}


def read(path):
    with open(path, encoding='utf-8') as fh:
        return fh.read()


def languages():
    """Language codes present in the repository, taken from the file names."""
    found = collections.defaultdict(list)
    for f in sorted(glob.glob('*.html')):
        m = re.search(r'-([a-z]{2})\.html$', f)
        if m:
            found[m.group(1)].append(f)
    # the reference language is not a target
    found.pop('en', None)
    return found


def families(codes):
    fams = {}
    for f in glob.glob('*.html'):
        m = re.search(r'^(.*)-([a-z]{2})\.html$', f)
        if m and m.group(2) in codes:
            fams.setdefault(m.group(1), set()).add(m.group(2))
    return fams


def reference(family):
    for candidate in (family + '.html', family + '-en.html'):
        if os.path.exists(candidate):
            return candidate
    return None


def anchors(path):
    s = read(path)
    s = re.sub(r'<p class="langbar">.*?</p>', '', s, flags=re.S)
    s = re.sub(r'<div class="lang-switch">.*?</div>', '', s, flags=re.S)
    blocks = ''
    for tag in ('nav', 'footer'):
        for m in re.finditer(r'<%s[^>]*>(.*?)</%s>' % (tag, tag), s, re.S):
            blocks += m.group(1)
    return re.findall(r'<a\s[^>]*href="([^"]+)"[^>]*>(.*?)</a>', blocks, re.S)


def label_of(raw):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', raw)).strip()


def canonical(href, lang):
    """Key that identifies the same menu entry across languages."""
    if href.startswith(('http', 'mailto:')):
        return href
    base = href.split('#')[0]
    frag = href[len(base):]
    if lang and base.endswith('-%s.html' % lang):
        base = base[:-8] + '.html'
    return base + frag


def label_allowed(label, lang):
    x = re.sub(r'\s+', ' ', re.sub(r'[^\w\s@.]', '', label).strip().lower())
    if '@' in x:                       # e-mail addresses are not translated
        return True
    return x in ALLOW_ANY or x in ALLOW_BY_LANG.get(lang, set())


def audit():
    codes = languages()
    rows = []
    counts = collections.Counter()

    for family, langs in sorted(families(codes).items()):
        ref = reference(family)
        if not ref:
            continue
        ref_lang = 'en' if ref.endswith('-en.html') else None
        expected = {canonical(h, ref_lang): label_of(t) for h, t in anchors(ref)}

        for lang in sorted(langs):
            path = '%s-%s.html' % (family, lang)
            seen = {}
            for href, raw in anchors(path):
                key = canonical(href, lang)
                label = label_of(raw)
                seen[key] = label
                verdicts = []
                english = expected.get(key)

                if english and label == english and not label_allowed(label, lang):
                    verdicts.append('LABEL non tradotta')

                base = href.split('#')[0]
                if (not href.startswith(('http', 'mailto:', '#'))
                        and base.endswith('.html')
                        and not base.endswith('-%s.html' % lang)
                        and base not in MONOLINGUAL):
                    verdicts.append('HREF cross-lingua')

                if english is None:
                    verdicts.append('voce assente in EN')

                if verdicts:
                    rows.append((lang, path, label[:26], href[:28],
                                 '; '.join(verdicts)))
                    counts[lang] += 1

            for key in expected:
                if key not in seen:
                    rows.append((lang, path, '—', '(manca: %s)' % key[:22],
                                 'voce EN assente'))
                    counts[lang] += 1

    return sorted(codes), rows, counts


def main():
    codes, rows, counts = audit()
    print('lingue rilevate: ' + ', '.join(codes))
    print()
    print('%-4s %-24s %-27s %-29s %s'
          % ('LNG', 'FILE', 'LABEL', 'HREF', 'ESITO'))
    print('-' * 116)
    for row in sorted(rows):
        print('%-4s %-24s %-27s %-29s %s' % row)
    if not rows:
        print('(nessuna riga non conforme)')
    print()
    print('RESIDUO PER LINGUA:')
    for code in codes:
        print('  %-4s %d' % (code.upper(), counts[code]))
    print('  %-4s %d' % ('TOT', sum(counts.values())))
    return sum(counts.values())


if __name__ == '__main__':
    sys.exit(min(main(), 125))
