// Search aliases only; canonical names/IDs and trading values never change.
const aliases = {
  'frost dragon': ['ледяной дракон', 'морозный дракон', 'фрост дракон'],
  'shadow dragon': ['теневой дракон', 'шадоу дракон'],
  'bat dragon': ['дракон летучая мышь', 'бэт дракон'],
  'ancient dragon': ['древний дракон'],
  'arctic reindeer': ['арктический олень'],
  'snow owl': ['снежная сова'],
  'safari egg': ['яйцо сафари'],
  'jungle egg': ['яйцо джунглей'],
  'royal egg': ['королевское яйцо'],
  'cracked egg': ['треснувшее яйцо'],
  'pet egg': ['яйцо питомца'],
  'icewing': ['ледяное крыло', 'айсвинг'],
  'chroma': ['хрома'],
  'harvester': ['харвестер', 'жнец'],
  'candy': ['конфета', 'кэнди'],
  'sugar': ['сахар', 'шугар'],
  'luger': ['люгер'],
  'icebreaker': ['ледокол', 'айсбрейкер'],
  'elderwood': ['элдервуд'],
  'lightbringer': ['лайтбрингер'],
  'darkbringer': ['даркбрингер'],
  'godly': ['годли'],
  'dragon': ['дракон'], 'unicorn': ['единорог'], 'owl': ['сова'],
  'parrot': ['попугай'], 'giraffe': ['жираф'], 'turtle': ['черепаха'],
  'kangaroo': ['кенгуру'], 'cow': ['корова'], 'dog': ['собака'],
  'cat': ['кот', 'кошка'], 'shark': ['акула'], 'egg': ['яйцо', 'яйца'],
  'phoenix': ['феникс'], 'buddha': ['будда'], 'dough': ['тесто'],
  'venom': ['яд', 'веном'], 'leopard': ['леопард'], 'kitsune': ['кицунэ', 'китсуне'],
  'yeti': ['йети'], 'gas': ['газ'], 'light': ['свет'], 'dark': ['тьма'],
  'ice': ['лёд', 'лед'], 'flame': ['пламя'], 'magma': ['магма'],
  'portal': ['портал'], 'rumble': ['грохот'], 'spirit': ['дух'],
};

const normalize = value => String(value || '').toLowerCase().replace(/ё/g, 'е').trim();

export const matchesItemName = (name, query, acronym = false) => {
  const needle = normalize(query);
  if (!needle) return true;
  const canonical = normalize(name);
  if (!canonical) return false;
  if (canonical.includes(needle)) return true;
  if (acronym && canonical.split(/[\s_-]+/).map(word => word[0] || '').join('').includes(needle)) return true;
  // Whole English words avoid matching “cat” in an unrelated item name.
  return Object.entries(aliases).some(([english, translations]) => {
    const words = canonical.replace(/[-_]/g, ' ');
    if (!(` ${words} `).includes(` ${english} `)) return false;
    return translations.some(alias => normalize(alias).includes(needle));
  });
};
