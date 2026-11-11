/**
 * Minimal robots.txt evaluation (Allow / Disallow with * and $), longest match wins,
 * using the group for our user agent or, failing that, the * group.
 */
interface Rule {
  allow: boolean;
  pattern: string;
}

function parseGroups(robotsTxt: string): Map<string, Rule[]> {
  const groups = new Map<string, Rule[]>();
  let agents: string[] = [];
  let lastWasAgent = false;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const field = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    if (field === 'user-agent') {
      if (!lastWasAgent) agents = [];
      agents.push(value.toLowerCase());
      if (!groups.has(value.toLowerCase())) groups.set(value.toLowerCase(), []);
      lastWasAgent = true;
    } else if (field === 'allow' || field === 'disallow') {
      lastWasAgent = false;
      if (value === '' && field === 'disallow') continue; // "Disallow:" means allow everything
      for (const agent of agents)
        groups.get(agent)?.push({ allow: field === 'allow', pattern: value });
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${regex}${anchored ? '$' : ''}`).test(path);
}

export function isAllowedByRobots(
  robotsTxt: string,
  path: string,
  userAgentToken: string,
): boolean {
  const groups = parseGroups(robotsTxt);
  const token = userAgentToken.toLowerCase();
  const own = [...groups.keys()].find((agent) => agent !== '*' && token.includes(agent));
  const rules = groups.get(own ?? '*') ?? [];
  let best: Rule | null = null;
  for (const rule of rules) {
    if (!matches(rule.pattern, path)) continue;
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow)
    ) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}
