import { projectsStore } from './projectsStore';
import * as projectsApi from '../../api/projects';
import { tokenStore } from '../../api/client';
import { normalizeProject } from '../../utils/project/nodeUtils';

let hydratedOnce = false;

/* On login/logout, reset the once-only flag so the next call to
   hydrateProjects() actually fires a fetch under the new identity.
   Without this, the flag stays `true` for the life of the page and
   User B sees an empty (or User A's) projects list with no re-fetch. */
if (typeof window !== 'undefined') {
  window.addEventListener('pmis:session-reset', () => {
    hydratedOnce = false;
  });
}

export async function hydrateProjects({ force = false } = {}) {
  if (hydratedOnce && !force) return;
  if (!tokenStore.get()) return;
  try {
    const list = await projectsApi.list();
    list.forEach((p) => normalizeProject(p));
    projectsStore.replaceAll(list);
    hydratedOnce = true;
  } catch {
    /* keep seed data; caller can retry */
  }
}

export async function fetchProjectTree(projectUuid) {
  if (!tokenStore.get()) return null;
  const p = await projectsApi.getTree(projectUuid);
  normalizeProject(p);
  return p;
}
