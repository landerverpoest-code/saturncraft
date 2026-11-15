// Dutch names of blocks, items and creatures: English registry name -> Dutch display name. Only DISPLAY text: the English
// names stay the identity of everything in code, commands, saves and multiplayer. tName() (ui/i18n.js) looks a name up here
// first and then tries the pattern rules of ui/nameRules.js, so derived names (slabs, wool colours, tool sets, elixirs...)
// need no entry. Invented proper names of this game (Mooxen, Fleecer, Tidestone, Hushvine...) simply stay as they are.

// the 16 colours: [bare form (het-words and plurals), inflected form (de-words)]
export const COLOURS = {
  White: ['Wit', 'Witte'], Orange: ['Oranje', 'Oranje'], Magenta: ['Magenta', 'Magenta'],
  'Light Blue': ['Lichtblauw', 'Lichtblauwe'], Yellow: ['Geel', 'Gele'], Lime: ['Limoengroen', 'Limoengroene'],
  Pink: ['Roze', 'Roze'], Gray: ['Grijs', 'Grijze'], 'Light Gray': ['Lichtgrijs', 'Lichtgrijze'],
  Cyan: ['Cyaan', 'Cyaan'], Purple: ['Paars', 'Paarse'], Blue: ['Blauw', 'Blauwe'], Brown: ['Bruin', 'Bruine'],
  Green: ['Groen', 'Groene'], Red: ['Rood', 'Rode'], Black: ['Zwart', 'Zwarte'],
};

// what a colour is combined with: [Dutch noun, 'de' = inflected colour (de-word), 'het' = bare colour]
export const COLOUR_PRODUCTS = {
  'Stained Glass Pane': ['getinte ruit', 'de'], 'Stained Glass': ['getint glas', 'het'], Wool: ['wol', 'de'],
  Carpet: ['tapijt', 'het'], Concrete: ['beton', 'het'], Terracotta: ['terracotta', 'het'], Candle: ['kaars', 'de'],
  'Gloomshell Box': ['Gloomshell-doos', 'de'], 'Glazed Tiles': ['geglazuurde tegels', 'de'],
  'Firework Star': ['vuurwerkster', 'de'], 'Star Rocket': ['sterraket', 'de'], Dye: ['kleurstof', 'de'],
};

// the wood families: stem of the Dutch compounds ("Eiken" + "houten planken", "Eiken" + "stam")
export const WOODS = {
  Oak: 'Eiken', Birch: 'Berken', Spruce: 'Sparren', Jungle: 'Jungle', Acacia: 'Acacia', 'Dark Oak': 'Donkereiken',
  Mangrove: 'Mangrove', Blossom: 'Bloesem', Bamboo: 'Bamboe', Bog: 'Moeras',
};
// [Dutch noun, true = "<Stem>houten <noun>" (adjective form), false = compound "<Stem><noun>"]
export const WOOD_PARTS = {
  Planks: ['planken', true], 'Fence Gate': ['hekpoort', true], Fence: ['hek', true], Trapdoor: ['luik', true],
  Door: ['deur', true], Slab: ['plaat', true], Stairs: ['trap', true], Sign: ['bord', true], Boat: ['boot', true],
  Log: ['stam', false], Leaves: ['bladeren', false], Sapling: ['zaailing', false],
};

// tool and armour materials (adjective) and kinds
export const GEAR_MATERIALS = {
  Wooden: 'Houten', Stone: 'Stenen', Iron: 'IJzeren', Golden: 'Gouden', Gold: 'Gouden', Diamond: 'Diamanten',
  Leather: 'Leren', Slagsteel: 'Slagstalen', Copper: 'Koperen', Shellback: 'Shellback',
};
export const GEAR_KINDS = {
  Pickaxe: 'houweel', Axe: 'bijl', Shovel: 'schep', Sword: 'zwaard', Hoe: 'schoffel', Warhammer: 'oorlogshamer',
  Dagger: 'dolk', Glaive: 'glavie', 'Returning Disc': 'werpschijf', Helmet: 'helm', Chestplate: 'borstplaat',
  Leggings: 'beenbeschermers', Boots: 'laarzen', 'Horse Armour': 'paardenharnas',
};

// elixir effects as they read after "van" ("Elixer van snelheid")
export const EFFECT_NAMES = {
  Swiftness: 'snelheid', Slowness: 'traagheid', Leaping: 'springkracht', Strength: 'kracht', Healing: 'genezing',
  Harming: 'schade', Poison: 'vergif', Regeneration: 'regeneratie', 'Fire Resistance': 'vuurbestendigheid',
  'Water Breathing': 'waterademhaling', 'Night Vision': 'nachtzicht', Invisibility: 'onzichtbaarheid',
  Weakness: 'zwakte', 'Slow Falling': 'langzaam vallen', 'the Shellback': 'de Shellback', Decay: 'verval',
  Luck: 'geluk', 'Bad Luck': 'pech', Haste: 'haast', Ironskin: 'ijzerhuid', Warding: 'bescherming', 'the Marsh': 'het moeras',
};

// creature names (checked first by tCreature(): "Hopper" is a creature here but a funnel-like block elsewhere)
export const CREATURE_NAMES = {
  Dolphin: 'Dolfijn', 'Stone Mite': 'Steenmijt', Settler: 'Kolonist', 'Roving Peddler': 'Rondtrekkende marskramer', 'Mending Crystal': 'Herstelkristal',
  'Elder Deepeye': 'Oude Deepeye', 'Dune Shambler': 'Duin-Shambler', 'Sodden Shambler': 'Doorweekte Shambler',
  'Rime Rattler': 'Rijp-Rattler', Hopper: 'Hopper',
};

export default {
  // ---- stems used by the compound rules (ores, blocks, slabs...) ----
  'Stone': 'Steen', 'Grass': 'Gras', 'Coal': 'Steenkool', 'Iron': 'IJzer', 'Copper': 'Koper', 'Gold': 'Goud', 'Diamond': 'Diamant',
  'Cinnabar': 'Cinnaber', 'Azurite': 'Azuriet', 'Beryl': 'Beril', 'Deepstone': 'Diepsteen', 'Snow': 'Sneeuw',
  'Slime': 'Slijm', 'Honey': 'Honing', 'Bone': 'Bot', 'Moss': 'Mos', 'Violite': 'Violiet', 'Emberquartz': 'Emberkwarts',
  'Dried Kelp': 'Gedroogde kelp', 'Brown Mushroom': 'Bruine paddenstoel', 'Red Mushroom': 'Rode paddenstoel',
  'Stone Brick': 'Stenen baksteen', 'Mud Brick': 'Modderbaksteen', 'Ashstone Brick': 'Ashstone-baksteen',
  'Tidestone Brick': 'Tidestone-baksteen', 'Dark Tidestone': 'Donkere Tidestone', 'Smooth Stone': 'Gladde steen',
  'Mossy Cobblestone': 'Bemoste keisteen', 'Cobbled Deepstone': 'Diepsteenkeisteen', 'Smooth Basalt': 'Gladde basalt',
  'Azure Mosaic': 'Azuurmozaïek', 'Tube Coral': 'Buiskoraal', 'Brain Coral': 'Hersenkoraal', 'Bubble Coral': 'Bellenkoraal',
  'Fire Coral': 'Vuurkoraal', 'Horn Coral': 'Hoornkoraal',

  // ---- terrain and minerals ----
  'Air': 'Lucht', 'Fire': 'Vuur', 'Dirt': 'Aarde', 'Cobblestone': 'Keisteen', 'Bedrock': 'Bodemgesteente', 'Water': 'Water', 'Sand': 'Zand',
  'Gravel': 'Grind', 'Glass': 'Glas', 'Sandstone': 'Zandsteen', 'Ice': 'IJs', 'Clay': 'Klei', 'Tall Grass': 'Hoog gras',
  'Dead Bush': 'Dode struik', 'Obsidian': 'Obsidiaan', 'Wool': 'Wol', 'Granite': 'Graniet', 'Diorite': 'Dioriet',
  'Andesite': 'Andesiet', 'Tuff': 'Tufsteen', 'Snowy Grass Block': 'Besneeuwd grasblok', 'Stone Bricks': 'Stenen bakstenen',
  'Farmland': 'Akkerland', 'Wheat Crops': 'Tarwegewas', 'Mossy Stone Bricks': 'Bemoste stenen bakstenen',
  'Cracked Stone Bricks': 'Gebarsten stenen bakstenen', 'Chiseled Stone Bricks': 'Gebeeldhouwde stenen bakstenen',
  'Bricks': 'Bakstenen', 'Red Sand': 'Rood zand', 'Terracotta': 'Terracotta', 'Mycelium': 'Mycelium', 'Mud': 'Modder',
  'Packed Mud': 'Samengeperste modder', 'Mud Bricks': 'Modderbakstenen', 'Packed Ice': 'Samengeperst ijs', 'Chalkstone': 'Krijtsteen',
  'Dirt Path': 'Aardepad', 'Snow Block': 'Sneeuwblok', 'Grass Block': 'Grasblok', 'Bone Block': 'Botblok', 'Moss Block': 'Mosblok',
  'Hay Bale': 'Hooibaal', 'Dried Kelp Block': 'Gedroogd kelpblok', 'Suspicious Sand': 'Verdacht zand', 'Suspicious Gravel': 'Verdacht grind',
  'Scorched Bricks': 'Geschroeide bakstenen', 'Vault Bricks': 'Kluisbakstenen', 'Ashstone Bricks': 'Ashstone-bakstenen',
  'Ashstone Tiles': 'Ashstone-tegels', 'Polished Ashstone': 'Gepolijst Ashstone', 'Sandvault Bricks': 'Sandvault-bakstenen',
  'Tidestone Bricks': 'Tidestone-bakstenen', 'Hollowstone Bricks': 'Hollowstone-bakstenen', 'Hollowbrick Pillar': 'Hollowbrick-pilaar',
  'Seepstone Spike': 'Seepstone-punt', 'Slag Ore': 'Slagerts', 'Dirge Crystal Ore': 'Dirge-kristalerts', 'Emberquartz Ore': 'Emberkwartserts',
  'Sealed Copper Block': 'Verzegeld koperblok', 'Dulled Copper': 'Dof koper', 'Tarnished Copper': 'Aangelopen koper',
  'Verdigris Copper': 'Koper met groenspaan', 'Sealed Dulled Copper': 'Verzegeld dof koper',
  'Sealed Tarnished Copper': 'Verzegeld aangelopen koper', 'Sealed Verdigris Copper': 'Verzegeld koper met groenspaan',

  'Mite-Riddled Stone': 'Steen vol mijten', 'Mite-Riddled Cobblestone': 'Keisteen vol mijten',
  'Mite-Riddled Stone Bricks': 'Stenen bakstenen vol mijten',

  // ---- plants and farming ----
  'Cactus': 'Cactus', 'Pumpkin': 'Pompoen', 'Pumpkin Lantern': 'Pompoenlantaarn', 'Carved Pumpkin': 'Uitgesneden pompoen',
  'Melon': 'Meloen', 'Potatoes': 'Aardappelen', 'Beetroots': 'Bieten', 'Carrots': 'Wortels', 'Vines': 'Ranken',
  'Lily Pad': 'Waterlelie', 'Brown Mushroom Block': 'Bruin paddenstoelblok', 'Red Mushroom Block': 'Rood paddenstoelblok',
  'Mushroom Stem': 'Paddenstoelsteel', 'Sugar Cane': 'Suikerriet', 'Cocoa': 'Cacao', 'Melon Stem': 'Meloenstengel',
  'Pumpkin Stem': 'Pompoenstengel', 'Bamboo': 'Bamboe', 'Kelp': 'Kelp', 'Seagrass': 'Zeegras', 'Azalea': 'Azalea',
  'Flowering Azalea': 'Bloeiende azalea', 'Cave Vines': 'Grotranken', 'Cave Vines with Glow Berries': 'Grotranken met gloeibessen',
  'Sweet Berry Bush': 'Zoete bessenstruik', 'Mangrove Propagule': 'Mangrovescheut', 'Mangrove Roots': 'Mangrovewortels',
  'Muddy Mangrove Roots': 'Modderige mangrovewortels', 'Blight Rose': 'Plaagroos', 'Moss Carpet': 'Mostapijt',
  'Dawnfern Plant': 'Dawnfern-plant', 'Dewberry Bramble': 'Dauwbramenstruik', 'Sungourd Stem': 'Sungourd-stengel',
  'Glowcap Stalk': 'Gloeikapsteel', 'Glowcap Cap': 'Gloeikap', 'Spore Loam': 'Sporenleem', 'Beanstalk': 'Bonenstaak',
  'Hushvine Flower': 'Hushvine-bloem', 'Wet Soakmoss': 'Natte Soakmoss', 'Budding Violite': 'Ontluikend Violiet',
  'Small Violite Bud': 'Kleine Violiet-knop', 'Medium Violite Bud': 'Middelgrote Violiet-knop', 'Large Violite Bud': 'Grote Violiet-knop',
  'Violite Cluster': 'Violiet-cluster',

  // ---- crafted blocks and stations ----
  'Workbench': 'Werkbank', 'Furnace': 'Oven', 'Torch': 'Fakkel', 'Chest': 'Kist', 'Ladder': 'Ladder', 'Bed': 'Bed',
  'Monster Spawner': 'Monsterkweker', 'Bookshelf': 'Boekenkast', 'Glass Pane': 'Glasruit', 'Barrel': 'Vat',
  'Bee Nest': 'Bijennest', 'Beehive': 'Bijenkorf', 'Enchanting Table': 'Betoveringstafel', 'Anvil': 'Aambeeld',
  'Hopper': 'Trechter', 'Rail': 'Rails', 'Cobweb': 'Spinnenweb', 'Brewing Alembic': 'Brouwalembiek', 'Campfire': 'Kampvuur',
  'Lantern': 'Lantaarn', 'Painting': 'Schilderij', 'Item Frame': 'Voorwerplijst', 'Lever': 'Hendel', 'Stone Button': 'Steenknop',
  'Wooden Pressure Plate': 'Houten drukplaat', 'Stone Pressure Plate': 'Stenen drukplaat', 'Light Weighted Plate': 'Lichte gewichtsplaat',
  'Heavy Weighted Plate': 'Zware gewichtsplaat', 'Repeater': 'Herhaler', 'Piston': 'Zuiger', 'Sticky Piston': 'Kleverige zuiger',
  'Piston Head': 'Zuigerkop', 'Chime Block': 'Klokkenspelblok', 'Cinnabar Wire': 'Cinnaberdraad', 'Cinnabar Torch': 'Cinnaberfakkel',
  'Cinnabar Lamp': 'Cinnaberlamp', 'Storm Rod': 'Stormstaaf', 'Composter': 'Composteerton', 'Jukebox': 'Jukebox', 'Smoker': 'Rookoven',
  'Blast Furnace': 'Hoogoven', 'Candle': 'Kaars', 'Scaffolding': 'Steiger', 'Flower Pot': 'Bloempot', 'Chain': 'Ketting',
  'Beacon': 'Baken', 'Dispenser': 'Automaat', 'Dropper': 'Druppelaar', 'Grindstone': 'Slijpsteen', 'Stonecutter': 'Steenzaag',
  'Comparator': 'Vergelijker', 'Observer': 'Waarnemer', 'Daylight Sensor': 'Daglichtsensor', 'Decorated Pot': 'Versierde pot',
  'Lectern': 'Lessenaar', 'Target': 'Schietschijf', 'Cake': 'Taart', 'Vault': 'Kluis', 'Loom': 'Weefgetouw',
  'Fletching Table': 'Pijlenmakerstafel', 'Cartography Desk': 'Kaartenmakerstafel', 'Cartographer\'s Table': 'Kartografentafel',
  'Copper Grate': 'Koperen rooster', 'Copper Bulb': 'Koperen lamp', 'Proving Spawner': 'Beproevingskweker',
  'Ominous Proving Spawner': 'Onheilspellende beproevingskweker', 'Powered Rail': 'Aangedreven rails', 'Detector Rail': 'Detectorrails',
  'Activator Rail': 'Activeringsrails', 'Masonry Bench': 'Metselbank', 'Whetstone Stand': 'Wetsteenstandaard',
  'Armorer\'s Rack': 'Wapensmidrek', 'Cooking Pot': 'Kookpot', 'Snare Post': 'Strikpaal', 'Snare Cord': 'Strikkoord',
  'Pulse Gate': 'Pulspoort', 'Sunburst Mosaic': 'Zonnestraalmozaïek', 'Leaded Glass': 'Glas-in-lood', 'Leaded Glass Pane': 'Glas-in-loodruit',
  'Rose Window': 'Roosvenster', 'Lighthouse Lens': 'Vuurtorenlens', 'Chandelier': 'Kroonluchter', 'Iron Brazier': 'IJzeren vuurschaal',
  'Rope Ladder': 'Touwladder', 'Bounty Board': 'Opdrachtenbord', 'Sun Glyph': 'Zonneglyph', 'Dart Trap': 'Pijlenval',
  'Hag\'s Cauldron': 'Heksenketel', 'Echo Coffer': 'Echokistje', 'Assembler': 'Assemblagetafel', 'Tide Heart': 'Getijhart',
  'Ember Hearth': 'Emberhaard', 'Spore Lantern': 'Sporenlantaarn', 'Tide Lantern': 'Tide-lantaarn', 'Starfall Core': 'Sterrenregenkern',
  'Shaded Glass': 'Donker glas', 'Hollow Frame': 'Hollow-raam', 'Hollow Frame with Eye': 'Hollow-raam met oog', 'Hollow Gate': 'Hollow-poort',
  'Far Gate': 'Verre poort', 'Wisp Rod': 'Wisp-staaf', 'Wyrm Head': 'Wyrmkop', 'Gloomshell Box': 'Gloomshell-doos',
  'Hush Vein': 'Hush-ader', 'Hush Sensor': 'Hush-sensor', 'Hush Shrieker': 'Hush-schreeuwer', 'Hush Catalyst': 'Hush-katalysator',
  'Calibrated Hush Sensor': 'Gekalibreerde Hush-sensor', 'Amber Croaklight': 'Amber-kwaaklicht', 'Pearl Croaklight': 'Parel-kwaaklicht',
  'Moss Croaklight': 'Mos-kwaaklicht', 'Lit Furnace': 'Brandende oven',

  // ---- materials, drops and tools ----
  'Stick': 'Stok', 'Raw Iron': 'Ruw ijzer', 'Raw Copper': 'Ruw koper', 'Raw Gold': 'Ruw goud', 'Cinnabar Dust': 'Cinnaberpoeder',
  'Flint': 'Vuursteen', 'Clay Ball': 'Kleibal', 'Leather': 'Leer', 'Feather': 'Veer', 'String': 'Draad', 'Arrow': 'Pijl',
  'Blast Powder': 'Explosiepoeder', 'Void Pearl': 'Void-parel', 'Egg': 'Ei', 'Skitterer Eye': 'Skitterer-oog',
  'Bucket': 'Emmer', 'Water Bucket': 'Wateremmer', 'Lava Bucket': 'Lavaemmer', 'Milk Bucket': 'Melkemmer', 'Bow': 'Boog',
  'Bowl': 'Kom', 'Shears': 'Schaar', 'Flint and Steel': 'Aansteker', 'Rabbit Hide': 'Konijnenvel', 'Ink Sac': 'Inktzak',
  'Compass': 'Kompas', 'Clock': 'Klok', 'Saddle': 'Zadel', 'Shield': 'Schild', 'Minecart': 'Mijnwagen', 'Fishing Rod': 'Hengel',
  'Slimeball': 'Slijmbal', 'Snowball': 'Sneeuwbal', 'Paper': 'Papier', 'Book': 'Boek', 'Brick': 'Baksteen', 'Bone Meal': 'Beendermeel',
  'Ember Rod': 'Emberstaaf', 'Ember Powder': 'Emberpoeder', 'Ember Quartz': 'Emberkwarts', 'Glowshard Dust': 'Glowshard-stof',
  'Eye of the Void': 'Oog van de Void', 'Enchanted Book': 'Betoverd boek', 'Glass Vial': 'Glazen flesje', 'Sugar': 'Suiker',
  'Ember Cream': 'Embercrème', 'Wraith Tear': 'Wraithtraan', 'Empty Map': 'Lege kaart', 'Map': 'Kaart', 'Honeycomb': 'Honingraat',
  'Honey Bottle': 'Honingfles', 'Shellback Scute': 'Shellback-schub', 'Shellback Helmet': 'Shellback-helm', 'Crag Horn': 'Rotshoorn',
  'Tide Shard': 'Tide-scherf', 'Tide Crystals': 'Tide-kristallen', 'Violite Shard': 'Violiet-scherf', 'Gloomshell Husk': 'Gloomshell-schil',
  'Drift Membrane': 'Drijfmembraan', 'Sky Rocket': 'Vuurpijl', 'Popped Hushfruit': 'Gepoft Hushfruit', 'Crossbow': 'Kruisboog',
  'Crossbow (Loaded)': 'Kruisboog (geladen)', 'Tidespear': 'Tide-speer', 'Charm of Undying': 'Amulet van het Onsterfelijke',
  'Glow Berries': 'Gloeibessen', 'Armor Stand': 'Wapenrustingstandaard', 'Fire Charge': 'Vuurbal', 'Hush Shard': 'Hush-scherf',
  'Lead': 'Lijn', 'Name Tag': 'Naamplaatje', 'Bundle': 'Bundel', 'Brush': 'Kwast', 'Hollow Breath': 'Hollow-adem',
  'Writable Book': 'Schrijfbaar boek', 'Written Book': 'Beschreven boek', 'Proving Key': 'Beproevingssleutel', 'Gale Rod': 'Windstaaf',
  'Tattered Book': 'Gescheurd boek', 'Glowcap Spores': 'Gloeikapsporen', 'Slag Chunk': 'Slakbrok', 'Dirge Crystal': 'Dirge-kristal',
  'Dirgestep Boots': 'Dirgestep-laarzen', 'Bucket of Tarnling': 'Emmer met Tarnling', 'Surveyor Wand': 'Landmeterstaf',
  'Roasted Frostroot': 'Geroosterde Frostroot', 'Dewberries': 'Dauwbessen', 'Sungourd Seeds': 'Sungourd-zaad', 'Dawnfern Seeds': 'Dawnfern-zaad',
  'Chest Boat': 'Kistboot', 'Minecart with Chest': 'Mijnwagen met kist', 'Minecart with Furnace': 'Mijnwagen met oven',
  'Thistle Harness': 'Distelharnas', 'Slagheart Sigil': 'Slagheart-zegel', 'Colossus Core': 'Colossuskern', 'Tallow': 'Talk',
  'Lantern Gland': 'Lantaarnklier', 'Diver\'s Lamp': 'Duikerslamp', 'Diver\'s Helm': 'Duikershelm', 'Fleet Anklet': 'Snelle enkelband',
  'Lodestone Charm': 'Magneetsteenamulet', 'Warding Amulet': 'Beschermamulet', 'Miner\'s Loupe': 'Mijnwerkersloep',
  'Lantern Charm': 'Lantaarnamulet', 'Ember Band': 'Emberband', 'Peat Clot': 'Veenklont', 'Snapper Fang': 'Snappertand',
  'Bog Essence': 'Moerasessence', 'Farscope': 'Verrekijker', 'Waymark Compass': 'Wegwijzerkompas', 'Plate Scale': 'Plaatschub',
  'Howler Barding': 'Howler-harnas', 'Creature Egg': 'Wezenei', 'Slagsteel Ingot': 'Slagsteelstaaf',

  // ---- food ----
  'Raw Pork Chop': 'Rauwe varkenskotelet', 'Roast Pork Chop': 'Gebraden varkenskotelet', 'Raw Beef': 'Rauw rundvlees', 'Steak': 'Biefstuk',
  'Raw Fowl': 'Rauw gevogelte', 'Roast Fowl': 'Gebraden gevogelte', 'Raw Mutton': 'Rauw schapenvlees', 'Roast Mutton': 'Gebraden schapenvlees',
  'Rotten Flesh': 'Rottend vlees', 'Apple': 'Appel', 'Wheat Seeds': 'Tarwezaad', 'Wheat': 'Tarwe', 'Bread': 'Brood', 'Carrot': 'Wortel',
  'Potato': 'Aardappel', 'Baked Potato': 'Gebakken aardappel', 'Poisonous Potato': 'Giftige aardappel', 'Beetroot': 'Biet',
  'Beetroot Seeds': 'Bietenzaad', 'Beetroot Soup': 'Bietensoep', 'Raw Rabbit': 'Rauw konijn', 'Cooked Rabbit': 'Gebraden konijn',
  'Bear Meat': 'Berenvlees', 'Melon Seeds': 'Meloenzaad', 'Pumpkin Seeds': 'Pompoenzaad', 'Cocoa Beans': 'Cacaobonen', 'Cookie': 'Koekje',
  'Melon Slice': 'Meloenschijf', 'Pumpkin Pie': 'Pompoentaart', 'Mushroom Stew': 'Paddenstoelenstoofpot', 'Gilded Melon Slice': 'Vergulde meloenschijf',
  'Gilded Carrot': 'Vergulde wortel', 'Gilded Apple': 'Vergulde appel', 'Fermented Skitterer Eye': 'Gefermenteerd Skitterer-oog',
  'Sweet Berries': 'Zoete bessen', 'Raw Venison': 'Rauw hertenvlees', 'Roast Venison': 'Gebraden hertenvlees',
  'Gourd Wedge': 'Kalebasschijf', 'Hunter\'s Stew': 'Jagersstoofpot', 'Fisher\'s Chowder': 'Vissersoep', 'Forager\'s Stew': 'Verzamelaarsstoofpot',
  'Hearty Hotpot': 'Machtige hutspot', 'Seafarer\'s Pot': 'Zeemanspot', 'Gourd Soup': 'Kalebassoep', 'Berry Tart': 'Bessentaart',
  'Gourd Pie': 'Kalebastaart', 'Raw Crab': 'Rauwe krab', 'Roast Crab': 'Gebraden krab', 'Fish Pie': 'Vistaart', 'Gilded Perch': 'Vergulde baars',
  'Roast Gilded Perch': 'Gebraden vergulde baars', 'Raw Silverfin': 'Rauwe Silverfin', 'Cooked Silverfin': 'Gebakken Silverfin',
  'Raw Redfin': 'Rauwe Redfin', 'Cooked Redfin': 'Gebakken Redfin', 'Raw Lanternfin': 'Rauwe Lanternfin', 'Cooked Lanternfin': 'Gebakken Lanternfin',
  'Raw Bogcarp': 'Rauwe Bogcarp', 'Roast Bogcarp': 'Gebraden Bogcarp', 'Raw Dunefin': 'Rauwe Dunefin', 'Roast Dunefin': 'Gebraden Dunefin',

  // ---- elixirs without an effect ----
  'Water Vial': 'Waterflesje', 'Murky Elixir': 'Troebel elixer', 'Bland Elixir': 'Flauw elixer', 'Thick Elixir': 'Dik elixer',

  // ---- map charts ----
  'Sunken Ruins Chart': 'Kaart: Verzonken ruïnes', 'Sun Tomb Chart': 'Kaart: Zonnegraf', 'Skywatch Chart': 'Kaart: Skywatch',
  'Tide Citadel Chart': 'Kaart: Tide-citadel', 'Outpost Chart': 'Kaart: Buitenpost', 'Rimekeep Chart': 'Kaart: Rimekeep',
  'Sporehall Chart': 'Kaart: Sporenhal',
};
