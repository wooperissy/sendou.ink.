import { ordinal } from "openskill";
import { sql } from "~/db/sql";
import type { Skill } from "~/db/types";
import { identifierToUserIds } from "~/features/mmr/mmr-utils";
import type { TournamentSummary } from "../core/summarizer.server";

const addSkillStm = sql.prepare(/* sql */ `
  insert into "Skill" (
    "tournamentId",
    "mu",
    "sigma",
    "ordinal",
    "userId",
    "identifier",
    "matchesCount",
    "season"
  )
  values (
    @tournamentId,
    @mu,
    @sigma,
    @ordinal,
    @userId,
    @identifier,
    @matchesCount + coalesce((select max("matchesCount") from "Skill" where "userId" = @userId or "identifier" = @identifier group by "userId", "identifier"), 0),
    @season
  ) returning *
`);

const addSkillTeamUserStm = sql.prepare(/* sql */ `
  insert into "SkillTeamUser" (
    "skillId",
    "userId"
  ) values (
    @skillId,
    @userId
  ) on conflict("skillId", "userId") do nothing
`);

const addMapResultDeltaStm = sql.prepare(/* sql */ `
  insert into "MapResult" (
    "mode",
    "stageId",
    "userId",
    "wins",
    "losses",
    "season"
  ) values (
    @mode,
    @stageId,
    @userId,
    @wins,
    @losses,
    @season
  ) on conflict ("userId", "stageId", "mode", "season") do
  update
  set
    "wins" = "wins" + @wins,
    "losses" = "losses" + @losses
`);

const addPlayerResultDeltaStm = sql.prepare(/* sql */ `
  insert into "PlayerResult" (
    "ownerUserId",
    "otherUserId",
    "mapWins",
    "mapLosses",
    "setWins",
    "setLosses",
    "type",
    "season"
  ) values (
    @ownerUserId,
    @otherUserId,
    @mapWins,
    @mapLosses,
    @setWins,
    @setLosses,
    @type,
    @season
  ) on conflict ("ownerUserId", "otherUserId", "type", "season") do
  update
  set
    "mapWins" = "mapWins" + @mapWins,
    "mapLosses" = "mapLosses" + @mapLosses,
    "setWins" = "setWins" + @setWins,
    "setLosses" = "setLosses" + @setLosses
`);

const addTournamentResultStm = sql.prepare(/* sql */ `
  insert into "TournamentResult" (
    "tournamentId",
    "userId",
    "placement",
    "participantCount",
    "tournamentTeamId"
  ) values (
    @tournamentId,
    @userId,
    @placement,
    @participantCount,
    @tournamentTeamId
  )
`);

export const addSummary = sql.transaction(
	({
		tournamentId,
		summary,
		season,
	}: {
		tournamentId: number;
		summary: TournamentSummary;
		season?: number;
	}) => {
		for (const skill of summary.skills) {
			const insertedSkill = addSkillStm.get({
				tournamentId,
				mu: skill.mu,
				sigma: skill.sigma,
				ordinal: ordinal(skill),
				userId: skill.userId,
				identifier: skill.identifier,
				matchesCount: skill.matchesCount,
				season,
			}) as Skill;

			if (insertedSkill.identifier) {
				for (const userId of identifierToUserIds(insertedSkill.identifier)) {
					addSkillTeamUserStm.run({
						skillId: insertedSkill.id,
						userId,
					});
				}
			}
		}

		for (const mapResultDelta of summary.mapResultDeltas) {
			addMapResultDeltaStm.run({
				mode: mapResultDelta.mode,
				stageId: mapResultDelta.stageId,
				userId: mapResultDelta.userId,
				wins: mapResultDelta.wins,
				losses: mapResultDelta.losses,
				season,
			});
		}

		for (const playerResultDelta of summary.playerResultDeltas) {
			addPlayerResultDeltaStm.run({
				ownerUserId: playerResultDelta.ownerUserId,
				otherUserId: playerResultDelta.otherUserId,
				mapWins: playerResultDelta.mapWins,
				mapLosses: playerResultDelta.mapLosses,
				setWins: playerResultDelta.setWins,
				setLosses: playerResultDelta.setLosses,
				type: playerResultDelta.type,
				season,
			});
		}

		for (const tournamentResult of summary.tournamentResults) {
			addTournamentResultStm.run({
				tournamentId,
				userId: tournamentResult.userId,
				placement: tournamentResult.placement,
				participantCount: tournamentResult.participantCount,
				tournamentTeamId: tournamentResult.tournamentTeamId,
			});
		}
	},
);
