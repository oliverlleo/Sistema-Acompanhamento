from pathlib import Path
import re

# Executa a primeira passagem. Ela pode parar somente no relatório de arquivos restantes.
try:
    exec(compile(Path('scripts/fix_global_quantity_decimals.py').read_text(encoding='utf-8'), 'fix_global_quantity_decimals.py', 'exec'))
except RuntimeError as error:
    if not str(error).startswith('Conversão genérica restante:'):
        raise

ROOT = Path('public')
VERSION = '20260803-1648'
FIELD = r'(?:qty[A-Z][A-Za-z0-9_]*|[A-Za-z][A-Za-z0-9_]*Qty)'
CALL = re.compile(rf'\b(num|number)\(([A-Za-z_$][\w$]*)\.({FIELD})\)')

for path in ROOT.glob('*.js'):
    if path.name in {'material-flow.js', 'tracking-available-summary.js'}:
        continue
    text = path.read_text(encoding='utf-8')
    if not CALL.search(text):
        continue

    # Entrada do formulário de entrega direta pertence ao material aberto no modal.
    if path.name == 'direct-paint-delivery.js':
        text = text.replace(
            'number(data.directPaintingDeliveredQty)',
            'quantityNumber(material, data.directPaintingDeliveredQty)'
        )

    if not re.search(r'import\s*\{[^}]*\bquantityNumber\b[^}]*\}\s*from\s*[\'\"]\./material-flow\.js', text, flags=re.S):
        text = f"import {{ quantityNumber }} from './material-flow.js?v={VERSION}';\n" + text

    text = CALL.sub(lambda m: f'quantityNumber({m.group(2)}, {m.group(2)}.{m.group(3)})', text)
    text = re.sub(r"material-flow\.js\?v=[0-9-]+", f"material-flow.js?v={VERSION}", text)
    path.write_text(text, encoding='utf-8')

# A primeira passagem usa a versão anterior; unifica todos os imports e caches.
for path in ROOT.glob('*.js'):
    text = path.read_text(encoding='utf-8')
    text = re.sub(r"material-flow\.js\?v=[0-9-]+", f"material-flow.js?v={VERSION}", text)
    path.write_text(text, encoding='utf-8')

route = ROOT / 'route-features.js'
text = route.read_text(encoding='utf-8')
for filename in ['separated-projects.js', 'tracking-item-counts.js', 'tracking-available-summary.js', 'acompanhamento-detail.js', 'xlsx-import-fix.js', 'direct-paint-delivery.js']:
    text = re.sub(rf"{re.escape(filename)}\?v=[0-9-]+", f"{filename}?v={VERSION}", text)
route.write_text(text, encoding='utf-8')

index = ROOT / 'index.html'
text = index.read_text(encoding='utf-8')
text = re.sub(r"app\.js\?v=[0-9-]+", f"app.js?v={VERSION}", text)
text = re.sub(r"route-features\.js\?v=[0-9-]+", f"route-features.js?v={VERSION}", text)
index.write_text(text, encoding='utf-8')

bad = []
for path in ROOT.glob('*.js'):
    if path.name == 'tracking-available-summary.js':
        continue
    for line_no, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
        if CALL.search(line):
            bad.append(f'{path}:{line_no}: {line.strip()}')
if bad:
    raise RuntimeError('Conversão genérica ainda restante:\n' + '\n'.join(bad))

print('Segunda passagem concluída sem cálculos genéricos de quantidade.')
