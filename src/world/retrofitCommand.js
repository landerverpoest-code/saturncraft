// /retrofit: bring the edited, saved chunks of a world up to the newest generator features (world/retrofit.js).
//   /retrofit                 where the world stands
//   /retrofit dry [chunks]    count what would be placed; changes nothing
//   /retrofit apply [chunks]  place it (at most `chunks` saved chunks per run, 150 by default; run it again for the rest)
// Host / single player only, overworld only; it never runs by itself.
import { CURRENT_FEATURE_VERSION, cleanFeatureVersion, retrofitSaved, describeReport } from './retrofit.js';

export const RETROFIT_DEFAULT_LIMIT = 150;
export const RETROFIT_MAX_LIMIT = 2000;

export function runRetrofitCommand(game, args) {
  const usage = 'Usage: /retrofit [status],  /retrofit dry [chunks],  /retrofit apply [chunks]';
  const who = game.cmdActor; // a guest's command run by the host
  if ((game.net && !game.net.isHost) || (who && !who.host)) return 'Only the host can retrofit the world';
  if (!game.world || game.world.dimension !== 'overworld') return 'Go back to the overworld first: /dimension overworld';
  const sub = (args[0] || 'status').toLowerCase();
  const fv = cleanFeatureVersion(game.featureVersion, CURRENT_FEATURE_VERSION);
  if (sub === 'status') {
    let old = 0;
    for (const c of game.world.saved.values()) if (cleanFeatureVersion(c.fv, 0) < CURRENT_FEATURE_VERSION) old++;
    return [
      `Feature version ${fv} of ${CURRENT_FEATURE_VERSION}: ${old} saved chunk${old === 1 ? ' is' : 's are'} older than the generator.`,
      'Chunks nobody built in already get every feature when they load; /retrofit dry counts what the edited ones could still receive.',
    ];
  }
  if (sub !== 'dry' && sub !== 'apply') return usage;
  let limit = RETROFIT_DEFAULT_LIMIT;
  if (args[1] !== undefined) {
    limit = Number(args[1]);
    if (!Number.isInteger(limit) || limit < 1) return usage;
    limit = Math.min(limit, RETROFIT_MAX_LIMIT);
  }
  const dryRun = sub === 'dry';
  const report = retrofitSaved(game.world, { dryRun, limit });
  const lines = describeReport(report);
  if (!dryRun && !report.remaining && !report.loadedSkipped) {
    game.featureVersion = CURRENT_FEATURE_VERSION;
    lines.push(`The world is now at feature version ${CURRENT_FEATURE_VERSION}. Friends who are already connected see the new blocks after they rejoin.`);
  }
  return lines;
}
