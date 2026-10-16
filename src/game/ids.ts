// Game ids (V1-06): 128 random bits from the platform's secure generator,
// written as 22 base64url characters. There is no Math.random fallback: an
// id must stay unguessable once a board can see it.

export function newGameId(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const bytes = random(16);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
