/**
 * Dispersal Draft API client.
 *
 * Hand-rolled replacement for the source app's Orval-generated
 * `@workspace/api-client-react` package. It exposes the same hook names,
 * query-key helpers, and call shapes the ported pages/hooks/components expect
 * (query hooks take options under `{ query: ... }`; mutations are called as
 * `.mutate({ id, data }, opts)`; errors carry a `.data` field), but is
 * implemented with TanStack Query + the app's authed fetch and talks to the
 * integrated routes under `/api/dispersal`.
 */
import {
  useQuery,
  useMutation,
  type UseQueryOptions,
  type UseMutationOptions,
} from "@tanstack/react-query";
import { scAuthFetch } from "@/lib/scAuthFetch";

const BASE = "/api/dispersal";

// ── Types (mirror the server JSON; dates are ISO strings) ─────────────────────

export interface DraftRoom {
  id: number;
  creatorUserId: string | null;
  leagueName: string;
  shareCode: string;
  commissionerToken: string;
  numOrphanSlots: number;
  draftFormat: string;
  timeBankSeconds: number | null;
  isLocked: boolean;
  currentTurnStartedAt: string | null;
  dailyPauseStart: string | null;
  dailyPauseEnd: string | null;
  pauseTimezone: string | null;
  sleeperLeagueId: string | null;
  status: string;
  currentPickNumber: number;
  currentRound: number;
  createdAt: string;
  updatedAt: string;
}

export interface DraftParticipant {
  id: number;
  draftRoomId: number;
  username: string;
  isCommissioner: boolean;
  draftPosition: number | null;
  orphanTeamName: string | null;
  sleeperAvatarId: string | null;
  timeBankRemainingSeconds: number | null;
  joinedAt: string;
}

export interface DraftAsset {
  id: number;
  draftRoomId: number;
  name: string;
  type: string;
  position: string | null;
  team: string | null;
  notes: string | null;
  isDrafted: boolean;
  draftedByParticipantId: number | null;
  createdAt: string;
}

export interface DraftPick {
  id: number;
  draftRoomId: number;
  participantId: number;
  assetId: number;
  pickNumber: number;
  round: number;
  pickedAt: string;
  participantUsername: string;
  assetName: string;
  assetType: string;
}

export interface DraftRoomDetail {
  room: DraftRoom;
  participants: DraftParticipant[];
  assets: DraftAsset[];
  picks: DraftPick[];
  onTheClockParticipantId: number | null;
}

export interface DraftRoomSummary {
  totalAssets: number;
  draftedAssets: number;
  availableAssets: number;
  totalParticipants: number;
  picksPerRound: { round: number; picks: number }[];
  assetsByType: { type: string; total: number; drafted: number }[];
}

// ── Error + fetch helpers ─────────────────────────────────────────────────────

export class DispersalApiError extends Error {
  status: number;
  data: { error?: string } | null;
  constructor(status: number, data: { error?: string } | null) {
    super(data?.error || `Request failed (${status})`);
    this.name = "DispersalApiError";
    this.status = status;
    this.data = data;
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await scAuthFetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let data: { error?: string } | null = null;
    try { data = await res.json(); } catch { /* non-JSON error body */ }
    throw new DispersalApiError(res.status, data);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function qs(params?: Record<string, string | undefined>): string {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

// ── Query keys (prefix-compatible so socket invalidation hits param'd keys) ────

export const getGetDraftRoomQueryKey = (code: string) => ["dispersal", "draft-room", code] as const;
export const getListAssetsQueryKey = (roomId: number, params?: { type?: string; drafted?: string }) =>
  params ? (["dispersal", "assets", roomId, params] as const) : (["dispersal", "assets", roomId] as const);
export const getListParticipantsQueryKey = (roomId: number) => ["dispersal", "participants", roomId] as const;
export const getListPicksQueryKey = (roomId: number) => ["dispersal", "picks", roomId] as const;
export const getGetDraftRoomSummaryQueryKey = (roomId: number) => ["dispersal", "summary", roomId] as const;

// ── Query hooks ───────────────────────────────────────────────────────────────

type QueryOpt<T> = { query?: Partial<UseQueryOptions<T, DispersalApiError>> };

export function useGetDraftRoom(code: string, options?: QueryOpt<DraftRoomDetail>) {
  return useQuery<DraftRoomDetail, DispersalApiError>({
    queryKey: getGetDraftRoomQueryKey(code),
    queryFn: () => req<DraftRoomDetail>("GET", `/draft-rooms/${encodeURIComponent(code)}`),
    ...(options?.query ?? {}),
  });
}

export function useListAssets(
  roomId: number,
  params?: { type?: string; drafted?: string },
  options?: QueryOpt<DraftAsset[]>,
) {
  return useQuery<DraftAsset[], DispersalApiError>({
    queryKey: getListAssetsQueryKey(roomId, params),
    queryFn: () => req<DraftAsset[]>("GET", `/draft-rooms/${roomId}/assets${qs(params)}`),
    ...(options?.query ?? {}),
  });
}

export function useListParticipants(roomId: number, options?: QueryOpt<DraftParticipant[]>) {
  return useQuery<DraftParticipant[], DispersalApiError>({
    queryKey: getListParticipantsQueryKey(roomId),
    queryFn: () => req<DraftParticipant[]>("GET", `/draft-rooms/${roomId}/participants`),
    ...(options?.query ?? {}),
  });
}

export function useDraftRoomSummary(roomId: number, options?: QueryOpt<DraftRoomSummary>) {
  return useQuery<DraftRoomSummary, DispersalApiError>({
    queryKey: getGetDraftRoomSummaryQueryKey(roomId),
    queryFn: () => req<DraftRoomSummary>("GET", `/draft-rooms/${roomId}/summary`),
    ...(options?.query ?? {}),
  });
}

// ── Mutation hooks (Orval shape: variables `{ id?, data }`) ────────────────────

type MutOpt<TData, TVars> = UseMutationOptions<TData, DispersalApiError, TVars>;
type WithId<D> = { id: number; data: D };

function useIdMutation<TData, D>(
  method: string,
  pathFor: (id: number) => string,
  options?: MutOpt<TData, WithId<D>>,
) {
  return useMutation<TData, DispersalApiError, WithId<D>>({
    mutationFn: ({ id, data }) => req<TData>(method, pathFor(id), data),
    ...options,
  });
}

export function useCreateDraftRoom(options?: MutOpt<DraftRoom, { data: Record<string, unknown> }>) {
  return useMutation<DraftRoom, DispersalApiError, { data: Record<string, unknown> }>({
    mutationFn: ({ data }) => req<DraftRoom>("POST", `/draft-rooms`, data),
    ...options,
  });
}

export const useJoinDraftRoom = (o?: MutOpt<DraftParticipant, WithId<{ username: string }>>) =>
  useIdMutation<DraftParticipant, { username: string }>("POST", (id) => `/draft-rooms/${id}/participants`, o);

export const useMakePick = (o?: MutOpt<DraftPick, WithId<{ participantId: number; assetId: number }>>) =>
  useIdMutation<DraftPick, { participantId: number; assetId: number }>("POST", (id) => `/draft-rooms/${id}/picks`, o);

export const useManualPick = (o?: MutOpt<DraftPick, WithId<Record<string, unknown>>>) =>
  useIdMutation<DraftPick, Record<string, unknown>>("POST", (id) => `/draft-rooms/${id}/picks/manual`, o);

export const useUndoLastPick = (o?: MutOpt<DraftRoomDetail, WithId<Record<string, unknown>>>) =>
  useIdMutation<DraftRoomDetail, Record<string, unknown>>("POST", (id) => `/draft-rooms/${id}/picks/undo`, o);

export const useRetractPick = (o?: MutOpt<{ success: boolean }, WithId<{ participantId: number }>>) =>
  useIdMutation<{ success: boolean }, { participantId: number }>("POST", (id) => `/draft-rooms/${id}/picks/retract`, o);

export const useStartDraft = (o?: MutOpt<DraftRoom, WithId<Record<string, unknown>>>) =>
  useIdMutation<DraftRoom, Record<string, unknown>>("POST", (id) => `/draft-rooms/${id}/start`, o);

export const usePauseDraft = (o?: MutOpt<DraftRoom, WithId<Record<string, unknown>>>) =>
  useIdMutation<DraftRoom, Record<string, unknown>>("POST", (id) => `/draft-rooms/${id}/pause`, o);

export const useResumeDraft = (o?: MutOpt<DraftRoom, WithId<Record<string, unknown>>>) =>
  useIdMutation<DraftRoom, Record<string, unknown>>("POST", (id) => `/draft-rooms/${id}/resume`, o);

export const useUpdateDraftRoom = (o?: MutOpt<DraftRoom, WithId<Record<string, unknown>>>) =>
  useIdMutation<DraftRoom, Record<string, unknown>>("PATCH", (id) => `/draft-rooms/${id}/update`, o);

export const useAssignTeams = (o?: MutOpt<DraftParticipant[], WithId<Record<string, unknown>>>) =>
  useIdMutation<DraftParticipant[], Record<string, unknown>>("POST", (id) => `/draft-rooms/${id}/assign-teams`, o);

export const useDeleteDraftRoom = (o?: MutOpt<void, WithId<Record<string, unknown>>>) =>
  useIdMutation<void, Record<string, unknown>>("POST", (id) => `/draft-rooms/${id}/delete`, o);

export const useUpdateParticipant = (
  o?: MutOpt<DraftParticipant, { id: number; participantId: number; data: Record<string, unknown> }>,
) =>
  useMutation<DraftParticipant, DispersalApiError, { id: number; participantId: number; data: Record<string, unknown> }>({
    mutationFn: ({ id, participantId, data }) => req("PATCH", `/draft-rooms/${id}/participants/${participantId}`, data),
    ...o,
  });

export const useRemoveParticipant = (
  o?: MutOpt<void, { id: number; participantId: number; data?: Record<string, unknown> }>,
) =>
  useMutation<void, DispersalApiError, { id: number; participantId: number; data?: Record<string, unknown> }>({
    mutationFn: ({ id, participantId, data }) => req("DELETE", `/draft-rooms/${id}/participants/${participantId}`, data ?? {}),
    ...o,
  });

export const useCreateAsset = (o?: MutOpt<DraftAsset, WithId<Record<string, unknown>>>) =>
  useIdMutation<DraftAsset, Record<string, unknown>>("POST", (id) => `/draft-rooms/${id}/assets`, o);

export const useImportAssetsFromCsv = (
  o?: MutOpt<{ imported: number; errors: string[] }, WithId<{ commissionerToken: string; csvContent: string }>>,
) =>
  useIdMutation<{ imported: number; errors: string[] }, { commissionerToken: string; csvContent: string }>(
    "POST",
    (id) => `/draft-rooms/${id}/assets/import-csv`,
    o,
  );
