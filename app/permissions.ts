import type * as plusSuggestions from "~/db/models/plusSuggestions/queries.server";
import type {
  CalendarEvent,
  PlusSuggestion,
  User,
  UserWithPlusTier,
} from "./db/types";
import { allTruthy } from "./utils/arrays";
import { ADMIN_ID, LOHI_TOKEN_HEADER_NAME, MOD_IDS } from "./constants";
import invariant from "tiny-invariant";
import type { ManagersByBadgeId } from "./db/models/badges/queries.server";
import { databaseTimestampToDate } from "./utils/dates";
import type { FindMatchById } from "./features/tournament-bracket/queries/findMatchById.server";
import { isVotingActive } from "./modules/plus-server/voting-time-old";

// TODO: 1) move "root checkers" to one file and utils to one file 2) make utils const for more terseness

type IsAdminUser = Pick<User, "id">;
export function isAdmin(user?: IsAdminUser) {
  return user?.id === ADMIN_ID;
}

export function isMod(user?: IsAdminUser) {
  if (!user) return false;

  return isAdmin(user) || MOD_IDS.includes(user.id);
}

export function canPerformAdminActions(user?: IsAdminUser) {
  if (["development", "test"].includes(process.env.NODE_ENV)) return true;

  return isAdmin(user);
}

function adminOverride(user?: IsAdminUser) {
  if (isAdmin(user)) {
    return () => true;
  }

  return (canPerformActionAsNormalUser: boolean) =>
    canPerformActionAsNormalUser;
}

interface CanAddCommentToSuggestionArgs {
  user?: Pick<UserWithPlusTier, "id" | "plusTier">;
  suggestions: plusSuggestions.FindVisibleForUser;
  suggested: Pick<User, "id">;
  targetPlusTier: NonNullable<UserWithPlusTier["plusTier"]>;
}
export function canAddCommentToSuggestionFE(
  args: CanAddCommentToSuggestionArgs,
) {
  return allTruthy([
    !alreadyCommentedByUser(args),
    isPlusServerMember(args.user),
    args.user?.plusTier && args.targetPlusTier >= args.user?.plusTier,
  ]);
}

export function canAddCommentToSuggestionBE({
  user,
  suggestions,
  suggested,
  targetPlusTier,
}: CanAddCommentToSuggestionArgs) {
  return allTruthy([
    canAddCommentToSuggestionFE({
      user,
      suggestions,
      suggested,
      targetPlusTier,
    }),
    playerAlreadySuggested({ suggestions, suggested, targetPlusTier }),
    targetPlusTierIsSmallerOrEqual({ user, targetPlusTier }),
  ]);
}

interface CanDeleteCommentArgs {
  suggestionId: PlusSuggestion["id"];
  author: Pick<User, "id">;
  user?: Pick<User, "id" | "discordId">;
  suggestions: plusSuggestions.FindVisibleForUser;
}
export function canDeleteComment(args: CanDeleteCommentArgs) {
  const votingActive =
    process.env.NODE_ENV === "test" ? false : isVotingActive();

  if (isFirstSuggestion(args)) {
    if (votingActive) return false;

    return adminOverride(args.user)(
      allTruthy([isOwnComment(args), suggestionHasNoOtherComments(args)]),
    );
  }

  return isOwnComment(args);
}

export function isFirstSuggestion({
  suggestionId,
  suggestions,
}: Pick<CanDeleteCommentArgs, "suggestionId" | "suggestions">) {
  for (const suggestedUser of Object.values(suggestions).flat()) {
    for (const [i, suggestion] of suggestedUser.suggestions.entries()) {
      if (suggestion.id !== suggestionId) continue;

      return i === 0;
    }
  }

  throw new Error(`Invalid suggestion id: ${suggestionId}`);
}

function alreadyCommentedByUser({
  user,
  suggestions,
  suggested,
  targetPlusTier,
}: CanAddCommentToSuggestionArgs) {
  return Boolean(
    suggestions[targetPlusTier]
      ?.find((u) => u.suggestedUser.id === suggested.id)
      ?.suggestions.some((s) => s.author.id === user?.id),
  );
}

export function playerAlreadySuggested({
  suggestions,
  suggested,
  targetPlusTier,
}: Pick<
  CanAddCommentToSuggestionArgs,
  "suggestions" | "suggested" | "targetPlusTier"
>) {
  return Boolean(
    suggestions[targetPlusTier]?.find(
      (u) => u.suggestedUser.id === suggested.id,
    ),
  );
}

function targetPlusTierIsSmallerOrEqual({
  user,
  targetPlusTier,
}: Pick<CanAddCommentToSuggestionArgs, "user" | "targetPlusTier">) {
  return user?.plusTier && user.plusTier <= targetPlusTier;
}

function isOwnComment({ author, user }: CanDeleteCommentArgs) {
  return author.id === user?.id;
}

function suggestionHasNoOtherComments({
  suggestions,
  suggestionId,
}: Pick<CanDeleteCommentArgs, "suggestionId" | "suggestions">) {
  for (const suggestedUser of Object.values(suggestions).flat()) {
    for (const suggestion of suggestedUser.suggestions) {
      if (suggestion.id !== suggestionId) continue;

      return suggestedUser.suggestions.length === 1;
    }
  }

  throw new Error(`Invalid suggestion id: ${suggestionId}`);
}

export function canDeleteSuggestionOfThemselves() {
  return !isVotingActive();
}

interface CanSuggestNewUserFEArgs {
  user?: Pick<UserWithPlusTier, "id" | "plusTier">;
  suggestions: plusSuggestions.FindVisibleForUser;
}
export function canSuggestNewUserFE({
  user,
  suggestions,
}: CanSuggestNewUserFEArgs) {
  const votingActive =
    process.env.NODE_ENV === "test" ? false : isVotingActive();

  return allTruthy([
    !votingActive,
    !hasUserSuggestedThisMonth({ user, suggestions }),
    isPlusServerMember(user),
  ]);
}

interface CanSuggestNewUserBEArgs extends CanSuggestNewUserFEArgs {
  suggested: Pick<UserWithPlusTier, "id" | "plusTier">;
  targetPlusTier: NonNullable<UserWithPlusTier["plusTier"]>;
}
export function canSuggestNewUserBE({
  user,
  suggestions,
  suggested,
  targetPlusTier,
}: CanSuggestNewUserBEArgs) {
  return allTruthy([
    canSuggestNewUserFE({ user, suggestions }),
    !playerAlreadySuggested({ suggestions, suggested, targetPlusTier }),
    targetPlusTierIsSmallerOrEqual({ user, targetPlusTier }),
    !playerAlreadyMember({ suggested, targetPlusTier }),
  ]);
}

function isPlusServerMember(user?: Pick<UserWithPlusTier, "plusTier">) {
  return Boolean(user?.plusTier);
}

export function playerAlreadyMember({
  suggested,
  targetPlusTier,
}: Pick<CanSuggestNewUserBEArgs, "suggested" | "targetPlusTier">) {
  return suggested.plusTier && suggested.plusTier <= targetPlusTier;
}

function hasUserSuggestedThisMonth({
  user,
  suggestions,
}: Pick<CanSuggestNewUserFEArgs, "user" | "suggestions">) {
  return Object.values(suggestions)
    .flat()
    .some(
      ({ suggestions }) =>
        suggestions[0] && suggestions[0].author.id === user?.id,
    );
}

/** Some endpoints can only be accessed with an auth token. Used by Lohi bot and cron jobs. */
export function canAccessLohiEndpoint(request: Request) {
  invariant(process.env["LOHI_TOKEN"], "LOHI_TOKEN is required");
  return (
    request.headers.get(LOHI_TOKEN_HEADER_NAME) === process.env["LOHI_TOKEN"]
  );
}

interface CanEditBadgeOwnersArgs {
  user?: Pick<User, "id">;
  managers: ManagersByBadgeId;
}

export function canEditBadgeOwners({ user, managers }: CanEditBadgeOwnersArgs) {
  return adminOverride(user)(isBadgeManager({ user, managers }));
}

function isBadgeManager({
  user,
  managers,
}: Pick<CanEditBadgeOwnersArgs, "user" | "managers">) {
  if (!user) return false;
  return managers.some((manager) => manager.id === user.id);
}

export function canEditBadgeManagers(user?: IsAdminUser) {
  return isMod(user);
}

interface CanEditCalendarEventArgs {
  user?: Pick<User, "id">;
  event: Pick<CalendarEvent, "authorId">;
}
export function canEditCalendarEvent({
  user,
  event,
}: CanEditCalendarEventArgs) {
  return adminOverride(user)(user?.id === event.authorId);
}

export function canDeleteCalendarEvent({
  user,
  event,
  startTime,
}: CanEditCalendarEventArgs & { startTime: Date }) {
  return adminOverride(user)(
    user?.id === event.authorId && startTime.getTime() > new Date().getTime(),
  );
}

interface CanReportCalendarEventWinnersArgs {
  user?: Pick<User, "id">;
  event: Pick<CalendarEvent, "authorId">;
  startTimes: number[];
}
export function canReportCalendarEventWinners({
  user,
  event,
  startTimes,
}: CanReportCalendarEventWinnersArgs) {
  return allTruthy([
    canEditCalendarEvent({ user, event }),
    eventStartedInThePast(startTimes),
  ]);
}

function eventStartedInThePast(
  startTimes: CanReportCalendarEventWinnersArgs["startTimes"],
) {
  return startTimes.every(
    (startTime) =>
      databaseTimestampToDate(startTime).getTime() < new Date().getTime(),
  );
}

export function canEnableTOTools(user?: IsAdminUser) {
  return isAdmin(user);
}

interface CanAdminTournament {
  user?: Pick<User, "id">;
  event: Pick<CalendarEvent, "authorId">;
}
export function canAdminTournament({ user, event }: CanAdminTournament) {
  // temporary hack to let Njok admin tournaments as well
  if (user?.id === 14710) return true;

  return adminOverride(user)(user?.id === event.authorId);
}

export function canReportTournamentScore({
  match,
  user,
  ownedTeamId,
  event,
}: {
  match: NonNullable<FindMatchById>;
  user?: Pick<User, "id">;
  ownedTeamId?: number;
  event: CanAdminTournament["event"];
}) {
  const matchIsOver =
    match.opponentOne?.result === "win" || match.opponentTwo?.result === "win";

  return (
    !matchIsOver &&
    ((match.opponentOne?.id ?? -1) === ownedTeamId ||
      (match.opponentTwo?.id ?? -1) === ownedTeamId ||
      canAdminTournament({ user, event }))
  );
}

export function canAddCustomizedColorsToUserProfile(
  user?: Pick<User, "id" | "patronTier">,
) {
  if (!user) return false;

  return adminOverride(user)(
    Boolean(user?.patronTier) && user.patronTier! >= 2,
  );
}
