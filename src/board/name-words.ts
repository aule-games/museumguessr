// Word lists of the board's generated names (q3a, N17, M7). APPEND-ONLY:
// never edit, reorder or remove an entry, because every device's name is an
// index into these lists. A word that turns out to be unsafe is handled by
// the blocklist (npm run names:block), which re-derives only the names that
// contain it. A name version fixes how many words of each list it uses, so
// appending words changes no existing name. tests/unit/board-names.test.ts
// checks every word and every adjacent pair against data/name-list.json.

/** First word: a quality. */
export const QUALITIES = [
  'Able', 'Agile', 'Amiable', 'Artful', 'Bold', 'Bonny', 'Brave', 'Breezy', 'Bright', 'Brisk',
  'Calm', 'Candid', 'Canny', 'Careful', 'Cheery', 'Civil', 'Clever', 'Cosmic', 'Cozy', 'Curious',
  'Dapper', 'Daring', 'Dashing', 'Deft', 'Devoted', 'Diligent', 'Dreamy', 'Eager', 'Earnest', 'Elegant',
  'Epic', 'Fabled', 'Fair', 'Faithful', 'Fearless', 'Festive', 'Fine', 'Fleet', 'Fond', 'Frank',
  'Friendly', 'Gallant', 'Gentle', 'Genial', 'Gleeful', 'Glad', 'Graceful', 'Grand', 'Hardy', 'Hearty',
  'Helpful', 'Honest', 'Hopeful', 'Humble', 'Jaunty', 'Jolly', 'Jovial', 'Joyful', 'Keen', 'Kind',
  'Learned', 'Lively', 'Loyal', 'Lucid', 'Lucky', 'Majestic', 'Mellow', 'Merry', 'Mighty', 'Modest',
  'Musing', 'Nimble', 'Noble', 'Patient', 'Peaceful', 'Placid', 'Playful', 'Plucky', 'Polished', 'Polite',
  'Proud', 'Quick', 'Quiet', 'Radiant', 'Rapid', 'Ready', 'Regal', 'Restful', 'Rustic', 'Serene',
  'Sincere', 'Spirited', 'Splendid', 'Spry', 'Stately', 'Steady', 'Stellar', 'Sturdy', 'Sunny', 'Tender',
  'Thrifty', 'Tidy', 'Tranquil', 'Trusty', 'Upbeat', 'Valiant', 'Vivid', 'Warm', 'Wise', 'Witty',
] as const;

/** Second word: a colour or a material. */
export const MATERIALS = [
  'Amber', 'Azure', 'Beryl', 'Birch', 'Brass', 'Bronze', 'Cedar', 'Chalk', 'Chestnut', 'Cinnabar',
  'Citrine', 'Clay', 'Cobalt', 'Copper', 'Coral', 'Cotton', 'Crimson', 'Crystal', 'Denim', 'Ebony',
  'Ember', 'Emerald', 'Fern', 'Flax', 'Flint', 'Frost', 'Garnet', 'Gilded', 'Ginger', 'Glass',
  'Golden', 'Granite', 'Hazel', 'Heather', 'Honey', 'Indigo', 'Iron', 'Ivory', 'Jade', 'Jasper',
  'Lapis', 'Lavender', 'Lemon', 'Lilac', 'Linen', 'Maple', 'Marble', 'Meadow', 'Mint', 'Misty',
  'Moss', 'Nickel', 'Oak', 'Obsidian', 'Ochre', 'Olive', 'Onyx', 'Opal', 'Orchid', 'Paper',
  'Pearl', 'Pewter', 'Pine', 'Plum', 'Poppy', 'Quartz', 'Raven', 'Ruby', 'Russet', 'Saffron',
  'Sand', 'Sapphire', 'Satin', 'Scarlet', 'Sepia', 'Shell', 'Sienna', 'Silk', 'Silver', 'Slate',
  'Snow', 'Spruce', 'Steel', 'Stone', 'Straw', 'Tawny', 'Teal', 'Thistle', 'Tin', 'Topaz',
  'Umber', 'Velvet', 'Violet', 'Walnut', 'Wheat', 'Willow', 'Wool', 'Zinc', 'Cerulean', 'Vermilion',
] as const;

/** Third word: an animal or a thing found in a museum. */
export const THINGS = [
  'Amphora', 'Antelope', 'Atlas', 'Badger', 'Beacon', 'Bison', 'Bittern', 'Bobcat', 'Buffalo', 'Bunting',
  'Caribou', 'Chalice', 'Cheetah', 'Cicada', 'Comet', 'Compass', 'Condor', 'Coyote', 'Crane', 'Cricket',
  'Curlew', 'Dolphin', 'Dove', 'Egret', 'Elk', 'Falcon', 'Finch', 'Firefly', 'Fox', 'Gazelle',
  'Gecko', 'Gibbon', 'Goose', 'Griffin', 'Hare', 'Hawk', 'Hedgehog', 'Heron', 'Ibex', 'Ibis',
  'Jackal', 'Jay', 'Kestrel', 'Kite', 'Koala', 'Lantern', 'Lark', 'Lemur', 'Leopard', 'Lion',
  'Llama', 'Lynx', 'Magpie', 'Mantis', 'Marmot', 'Marten', 'Meerkat', 'Mosaic', 'Moth', 'Narwhal',
  'Newt', 'Nightjar', 'Ocelot', 'Oriole', 'Osprey', 'Otter', 'Owl', 'Panda', 'Panther', 'Parrot',
  'Pelican', 'Penguin', 'Petrel', 'Phoenix', 'Plover', 'Puffin', 'Quail', 'Quill', 'Rabbit', 'Robin',
  'Salmon', 'Sandpiper', 'Scroll', 'Seal', 'Sextant', 'Sparrow', 'Squirrel', 'Stag', 'Starling', 'Stork',
  'Swan', 'Tapestry', 'Tiger', 'Toucan', 'Turtle', 'Walrus', 'Wombat', 'Wren', 'Yak', 'Zebra',
] as const;
