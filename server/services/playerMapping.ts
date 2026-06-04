/**
 * Foreign-player to canonical-player mapping stub.
 */
export interface ForeignPlayer {
  platformPlayerId: string;
  name: string | null;
  position: string | null;
  nflTeam: string | null;
}

export interface PlayerMap {
  canonicalPlayerId: string | null;
  method: string;
  confidence: number;
}

export async function mapForeignPlayer(
  _platform: string,
  _foreign: ForeignPlayer,
): Promise<PlayerMap> {
  return { canonicalPlayerId: null, method: "none", confidence: 0 };
}

export async function rememberMapping(
  _platform: string,
  _foreign: ForeignPlayer,
  _map: PlayerMap,
): Promise<void> {}
