/** Server-defined capabilities and recipes, shared with the UI; GM output selects, never executes code. */
export const LIFE_ITEMS = [
  { id: 'timber', name: '목재', category: 'material', price: 3, capabilities: ['material', 'deliver'] },
  { id: 'stone', name: '돌', category: 'material', price: 2, capabilities: ['material', 'deliver'] },
  { id: 'herb', name: '찻잎', category: 'material', price: 2, capabilities: ['material', 'deliver'] },
  { id: 'tea-cup', name: '따뜻한 차', category: 'consume', price: 6, capabilities: ['consume', 'food', 'deliver'], effect: 'restore' },
  { id: 'hammer', name: '작업 망치', category: 'tool', price: 12, capabilities: ['tool', 'deliver'] },
  { id: 'stool', name: '나무 의자', category: 'place', price: 10, capabilities: ['place', 'deliver'] },
].map(i => ({ ...i, stackable: true, designRevision: 1 }))
export const FACILITIES = {
  merchant: { name: '잡화점', role: 'merchant', roof: 'shop', w: 4, h: 3, gold: 40, materials: { timber: 8, stone: 4 }, seconds: 60, service: 'shop' },
  guild: { name: '모험가 길드', role: 'guild', roof: 'guild', w: 4, h: 3, gold: 40, materials: { timber: 8, stone: 4 }, seconds: 60, service: 'quests' },
  workshop: { name: '공방', role: 'workshop', roof: 'shop', w: 4, h: 3, gold: 40, materials: { timber: 8, stone: 4 }, seconds: 60, service: 'production', fee: 2 },
  tea: { name: '찻집', role: 'tea', roof: 'tea', w: 4, h: 3, gold: 30, materials: { timber: 6, stone: 2 }, seconds: 45, service: 'production', fee: 1 },
  home: { name: '주택', role: 'home', roof: 'home', w: 4, h: 3, gold: 30, materials: { timber: 6, stone: 4 }, seconds: 45, service: 'rest', fee: 2 },
  warehouse: { name: '창고', role: 'warehouse', roof: 'home', w: 4, h: 3, gold: 35, materials: { timber: 8, stone: 2 }, seconds: 45, service: 'storage', fee: 1 },
  expansion: { name: '인접 지구 개방', gold: 50, materials: { timber: 4, stone: 4 }, seconds: 60 },
}
export const RECIPES = [
  { id: 'brew-tea', name: '차 끓이기', role: 'tea', inputs: { herb: 2 }, output: { itemId: 'tea-cup', quantity: 1 }, seconds: 10 },
  { id: 'make-stool', name: '의자 제작', role: 'workshop', inputs: { timber: 3 }, tool: 'hammer', output: { itemId: 'stool', quantity: 1 }, seconds: 20 },
]
export const LIFE_ACTIONS = ['buy', 'sell', 'use', 'store', 'take', 'produce', 'work', 'deliver', 'place', 'construct', 'cancel-construction', 'donate', 'temple-donate', 'service']
export const LIFE_INPUT = { type: 'object', additionalProperties: false, required: ['requestId', 'action', 'actorId'], properties: {
  requestId: { type: 'string', minLength: 16, maxLength: 160 }, action: { type: 'string', enum: LIFE_ACTIONS }, actorId: { type: 'string' },
  npcId: { type: 'string' }, itemId: { type: 'string' }, quantity: { type: 'integer', minimum: 1, maximum: 99 },
  recipeId: { type: 'string' }, buildingId: { type: 'string' }, questId: { type: 'string' }, constructionId: { type: 'string' },
  kind: { type: 'string', enum: Object.keys(FACILITIES) }, x: { type: 'integer', minimum: 0, maximum: 80 }, y: { type: 'integer', minimum: 0, maximum: 60 },
  funding: { type: 'string', enum: ['private', 'public'] }, direction: { type: 'string', enum: ['east', 'south'] },
  amount: { type: 'integer', minimum: 1, maximum: 10000 },
} }
export const LIFE_GM = { type: 'object', additionalProperties: false, required: ['approve', 'reason', 'item', 'facility'], properties: {
  approve: { type: 'boolean' }, reason: { type: 'string', maxLength: 240 },
  item: { type: 'object', additionalProperties: false, required: ['name', 'description', 'template', 'look'], properties: {
    name: { type: 'string', maxLength: 60 }, description: { type: 'string', maxLength: 240 },
    template: { type: 'string', enum: ['', ...LIFE_ITEMS.map(i => i.id)] }, look: { type: 'string', maxLength: 300 },
  } },
  facility: { type: 'object', additionalProperties: false, required: ['kind', 'x', 'y', 'direction'], properties: {
    kind: { type: 'string', enum: ['', ...Object.keys(FACILITIES)] }, x: { type: 'integer' }, y: { type: 'integer' }, direction: { type: 'string', enum: ['', 'east', 'south'] },
  } },
} }
