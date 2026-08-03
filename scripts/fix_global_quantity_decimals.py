from pathlib import Path
import re

ROOT = Path('public')
VERSION = '20260803-1645'
QUANTITY_FIELD = r'(?:qty[A-Z][A-Za-z0-9_]*|[A-Za-z][A-Za-z0-9_]*Qty)'


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    if old not in text:
        raise RuntimeError(f'{label}: trecho não encontrado')
    return text.replace(old, new, 1)


# Regra central: quantidade conhece a unidade do material.
path = ROOT / 'material-flow.js'
text = read(path)
old_number = """export function number(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined || value === '') return 0;
  let text = String(value).trim().replace(/\\s/g, '');
  if (/^-?\\d{1,3}(\\.\\d{3})+(,\\d+)?$/.test(text)) text = text.replace(/\\./g, '').replace(',', '.');
  else if (/^-?\\d+(,\\d+)$/.test(text)) text = text.replace(',', '.');
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}
"""
new_number = """export function number(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined || value === '') return 0;
  let text = String(value).trim().replace(/\\s/g, '');
  if (text.includes(',') && text.includes('.')) {
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) text = text.replace(/\\./g, '').replace(',', '.');
    else text = text.replace(/,/g, '');
  } else if (text.includes(',')) {
    text = text.replace(',', '.');
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizedQuantityUnit(material = {}) {
  return String(material.unit || '')
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function isDecimalQuantity(material = {}) {
  return ['m', 'm2', 'm²', 'metro', 'metros', 'kg'].includes(normalizedQuantityUnit(material));
}

export function quantityNumber(material = {}, value) {
  if (value === null || value === undefined || value === '') return 0;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0;
    // Importações antigas salvaram 435.554 m como 435554.
    if (isDecimalQuantity(material) && Number.isInteger(value) && Math.abs(value) >= 1000) return value / 1000;
    return value;
  }

  let text = String(value).trim().replace(/\\s/g, '');
  if (!text) return 0;
  if (text.includes(',') && text.includes('.')) {
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) text = text.replace(/\\./g, '').replace(',', '.');
    else text = text.replace(/,/g, '');
  } else if (text.includes(',')) {
    text = text.replace(',', '.');
  } else if (text.includes('.') && !isDecimalQuantity(material) && /^-?\\d{1,3}(\\.\\d{3})+$/.test(text)) {
    text = text.replace(/\\./g, '');
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}
"""
text = replace_once(text, old_number, new_number, 'material-flow number')
text = re.sub(rf'number\((material)\.({QUANTITY_FIELD})\)', r'quantityNumber(\1, \1.\2)', text)
write(path, text)

# Núcleo principal: mesma regra para filas, ações e validações.
path = ROOT / 'app.js'
text = read(path)
marker = "const clamp = (n, min, max) => Math.min(max, Math.max(min, n));"
helper = """const normalizedQuantityUnit = (material = {}) => String(material.unit || '')
  .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').trim().toLowerCase();
const isDecimalQuantity = (material = {}) => ['m', 'm2', 'm²', 'metro', 'metros', 'kg'].includes(normalizedQuantityUnit(material));
const quantityNum = (material = {}, value) => {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0;
    if (isDecimalQuantity(material) && Number.isInteger(value) && Math.abs(value) >= 1000) return value / 1000;
    return value;
  }
  let text = String(value).trim().replace(/\\s/g, '');
  if (!text) return 0;
  if (text.includes(',') && text.includes('.')) {
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) text = text.replace(/\\./g, '').replace(',', '.');
    else text = text.replace(/,/g, '');
  } else if (text.includes(',')) text = text.replace(',', '.');
  else if (text.includes('.') && !isDecimalQuantity(material) && /^-?\\d{1,3}(\\.\\d{3})+$/.test(text)) text = text.replace(/\\./g, '');
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
};
"""
if 'const quantityNum =' not in text:
    text = replace_once(text, marker, helper + marker, 'app helper')
text = re.sub(rf'num\(([A-Za-z_$][\w$]*)\.({QUANTITY_FIELD})\)', r'quantityNum(\1, \1.\2)', text)
text = re.sub(rf'fmtQty\(([A-Za-z_$][\w$]*)\.({QUANTITY_FIELD})\)', r'fmtQty(quantityNum(\1, \1.\2))', text)
write(path, text)

# Módulos com material-flow: usar quantityNumber em qualquer campo de quantidade.
for path in ROOT.glob('*.js'):
    if path.name in {'material-flow.js', 'app.js', 'tracking-available-summary.js', 'xlsx-import-fix.js'}:
        continue
    text = read(path)
    if "from './material-flow.js" not in text:
        continue

    def add_import(match):
        names = match.group(1)
        if 'quantityNumber' not in names:
            names = names.rstrip() + ', quantityNumber'
        return "import {" + names + f"}} from './material-flow.js?v={VERSION}';"

    text = re.sub(
        r"import\s*\{([^}]*)\}\s*from\s*'\./material-flow\.js\?v=[^']+';",
        add_import,
        text,
        count=1,
        flags=re.S,
    )
    text = re.sub(rf'number\(([A-Za-z_$][\w$]*)\.({QUANTITY_FIELD})\)', r'quantityNumber(\1, \1.\2)', text)
    text = re.sub(rf'formatQty\(([A-Za-z_$][\w$]*)\.({QUANTITY_FIELD})\)', r'formatQty(quantityNumber(\1, \1.\2))', text)
    write(path, text)

# Importação futura: descobrir unidade antes de converter a quantidade.
path = ROOT / 'xlsx-import-fix.js'
text = read(path)
if 'function quantityNum(value, unit' not in text:
    num_match = re.search(r'function num\(value\) \{.*?\n\}', text, flags=re.S)
    if not num_match:
        raise RuntimeError('xlsx num não encontrado')
    quantity_helper = """

function quantityNum(value, unit = '') {
  if (value === null || value === undefined || value === '') return 0;
  const normalizedUnit = String(unit || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').trim().toLowerCase();
  const decimalUnit = ['m', 'm2', 'm²', 'metro', 'metros', 'kg'].includes(normalizedUnit);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0;
    if (decimalUnit && Number.isInteger(value) && Math.abs(value) >= 1000) return value / 1000;
    return value;
  }
  let text = String(value).trim().replace(/\\s/g, '');
  if (!text) return 0;
  if (text.includes(',') && text.includes('.')) {
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) text = text.replace(/\\./g, '').replace(',', '.');
    else text = text.replace(/,/g, '');
  } else if (text.includes(',')) text = text.replace(',', '.');
  else if (text.includes('.') && !decimalUnit && /^-?\\d{1,3}(\\.\\d{3})+$/.test(text)) text = text.replace(/\\./g, '');
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}
"""
    text = text[:num_match.end()] + quantity_helper + text[num_match.end():]

quantity_block = re.compile(
    r"    const rawQuantity = getField\('quantity'\);\n"
    r"    let quantity = num\(rawQuantity\);\n"
    r"    let quantityFromUnitValue = false;\n"
    r"    const unitValue = num\(getField\('unitValue'\)\);"
)
replacement = """    const rawQuantity = getField('quantity');
    const importedUnit = String(getField('unit') || '').trim();
    let quantity = quantityNum(rawQuantity, importedUnit || 'un');
    let quantityFromUnitValue = false;
    const unitValue = quantityNum(getField('unitValue'), 'm');"""
text, count = quantity_block.subn(replacement, text, count=1)
if count != 1:
    raise RuntimeError('xlsx bloco de quantidade não encontrado')
text = text.replace("    let unit = String(getField('unit') || '').trim();", "    let unit = importedUnit;", 1)
write(path, text)

# Atualizar URLs de dependência e cache.
for path in ROOT.glob('*.js'):
    text = read(path)
    text = re.sub(r"material-flow\.js\?v=[0-9-]+", f"material-flow.js?v={VERSION}", text)
    write(path, text)

path = ROOT / 'route-features.js'
text = read(path)
for filename in ['separated-projects.js', 'tracking-item-counts.js', 'tracking-available-summary.js', 'acompanhamento-detail.js', 'xlsx-import-fix.js']:
    text = re.sub(rf"{re.escape(filename)}\?v=[0-9-]+", f"{filename}?v={VERSION}", text)
write(path, text)

path = ROOT / 'index.html'
text = read(path)
text = re.sub(r"app\.js\?v=[0-9-]+", f"app.js?v={VERSION}", text)
text = re.sub(r"route-features\.js\?v=[0-9-]+", f"route-features.js?v={VERSION}", text)
write(path, text)

# Não permitir que cálculos de quantidade continuem usando num/number genérico.
bad = []
pattern = re.compile(rf'\b(?:num|number)\([A-Za-z_$][\w$]*\.({QUANTITY_FIELD})\)')
for path in ROOT.glob('*.js'):
    if path.name == 'tracking-available-summary.js':
        continue
    for line_no, line in enumerate(read(path).splitlines(), 1):
        if pattern.search(line):
            bad.append(f'{path}:{line_no}: {line.strip()}')
if bad:
    raise RuntimeError('Conversão genérica restante:\n' + '\n'.join(bad))

print('Correção global aplicada.')
