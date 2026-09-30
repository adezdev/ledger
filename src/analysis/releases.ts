/**
 * How much a tag marks a release of the project itself. Monorepos also tag
 * their components (`ignore-0.4.26`, `pkg@1.2.3`); those are not milestones
 * of the project, so they weigh nothing.
 */
const PROJECT_VERSION = /^(?:v|version[-_]?|release[-_]?)?(\d+)\.(\d+)(?:\.(\d+))?(?:[-+._]?([0-9A-Za-z][0-9A-Za-z.-]*))?$/i;
const PRERELEASE = /^(alpha|beta|rc|pre|preview|dev|canary|next)/i;

/** 1 for a major or minor release, 0.5 for a patch, 0.3 for a pre-release, 0 for anything else. */
export function releaseWeight(tagName: string): number {
  const match = PROJECT_VERSION.exec(tagName.trim());
  if (!match) return 0;
  const suffix = match[4];
  if (suffix !== undefined && PRERELEASE.test(suffix)) return 0.3;
  if (suffix !== undefined && !/^\d/.test(suffix)) return 0;
  return match[3] === undefined || Number(match[3]) === 0 ? 1 : 0.5;
}

export function isProjectRelease(tagName: string): boolean {
  return releaseWeight(tagName) > 0;
}
