// Pottery Sherds: broken pieces of old pots found by brushing Suspicious Sand and Gravel
// (world/archaeology.js). Each carries one of eight motifs, an 8 x 8 picture ('#' = incised
// line) shown on its icon and on the side of a Decorated Pot made with it. Plain data, no
// imports, so items, textures, icons and the pot renderer can all read it.

export const SHERDS = [
  { key: 'ringed', name: 'Ringed Sherd', motif: ['...##...', '..####..', '########', '#.####.#', '########', '..####..', '...##...', '........'] },
  { key: 'three_suns', name: 'Three Suns Sherd', motif: ['.#....#.', '###..###', '.#....#.', '........', '...#....', '..###...', '...#....', '........'] },
  { key: 'wyrm', name: 'Wyrm Sherd', motif: ['.....##.', '....#..#', '....#...', '.....#..', '......#.', '#.....#.', '.#...#..', '..###...'] },
  { key: 'tide', name: 'Tide Sherd', motif: ['........', '.##..##.', '#..##..#', '........', '.##..##.', '#..##..#', '........', '........'] },
  { key: 'sprout', name: 'Sprout Sherd', motif: ['...#....', '.#.#.#..', '..###...', '...#....', '#..#..#.', '.#.#.#..', '..###...', '...#....'] },
  { key: 'watcher', name: 'Watcher Sherd', motif: ['........', '..####..', '.#....#.', '#..##..#', '#..##..#', '.#....#.', '..####..', '........'] },
  { key: 'antler', name: 'Antler Sherd', motif: ['#.#..#.#', '#.#..#.#', '.##..##.', '..#..#..', '...##...', '...##...', '..####..', '........'] },
  { key: 'ember', name: 'Ember Sherd', motif: ['...#....', '...##...', '..###.#.', '.#####..', '.##.###.', '##...##.', '.##.##..', '..###...'] },
];

/** Clay colours of a sherd and of a Decorated Pot (body, darker line, light edge). */
export const POT_CLAY = { body: '#a85a3c', line: '#3a1e14', light: '#c87a52', dark: '#7a3e28' };
