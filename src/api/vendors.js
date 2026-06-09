import { api } from './client';
import { ENDPOINTS } from './endpoint';
import { fromApi as userFromApi } from './users';

function unwrap(res) {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?._embedded?.elements)) return res._embedded.elements;
  if (Array.isArray(res?.data?._embedded?.elements)) return res.data._embedded.elements;
  if (Array.isArray(res?.items)) return res.items;
  if (Array.isArray(res?.data?.items)) return res.data.items;
  if (Array.isArray(res?.data)) return res.data;
  return [];
}

function unwrapOne(res) {
  if (res && typeof res === 'object' && res.data && typeof res.data === 'object' && !Array.isArray(res.data)) {
    return res.data;
  }
  return res;
}

// Project Mapping rows in VendorDetails carry user-facing labels
// ("Project Admin" / "Project Member") but the backend expects the
// role keys ("project_admin" / "project_member"). Normalize at the
// edge instead of at the UI so the display stays human-readable.
function toRoleKey(role) {
  if (!role) return '';
  const s = String(role).trim().toLowerCase();
  if (s === 'project admin' || s === 'project_admin') return 'project_admin';
  if (s === 'project member' || s === 'project_member') return 'project_member';
  return s.replace(/\s+/g, '_');
}

// Inverse of toRoleKey — used when seeding the form from the GET
// response. Backend payloads in this codebase have shipped both styles
// over time, so accept either and always return the human label.
function fromRoleKey(role) {
  if (!role) return '';
  const s = String(role).trim().toLowerCase();
  if (s === 'project_admin' || s === 'project admin') return 'Project Admin';
  if (s === 'project_member' || s === 'project member') return 'Project Member';
  return role;
}

function fromApi(v) {
  const projects = Array.isArray(v.projects) ? v.projects : [];
  // Backend returns role/user assignments as a flat list — one row per
  // (project, role). VendorDetails works with a nested shape:
  //   [{ projectId, roles: [{ role, userIds }] }]
  // Group here so the page can seed the table directly.
  const flatAssignments = Array.isArray(v.user_assignments)
    ? v.user_assignments
    : Array.isArray(v.userAssignments)
      ? v.userAssignments
      : [];
  const grouped = new Map();
  // Backend now embeds the user records that each assignment row references
  // under `user_assignments[].users[]`. Capture them here so the Project
  // Mapping table can render "login (First Last)" right away, instead of
  // showing the raw UUID until the global /users list resolves (and for
  // Project Admins, whose /users list won't include users from other
  // organizations at all).
  const embeddedUsersById = new Map();
  // Newer payloads ship the assignments already nested per project as
  //   projectAssignments: [{ projectId, roles: [{ role, userIds }] }]
  // which is exactly the shape the page works with. When present, seed
  // `grouped` straight from it so the Users column reflects the saved
  // selection (the flat user_assignments grouping below is the fallback
  // for older payloads).
  const nestedAssignments = Array.isArray(v.projectAssignments)
    ? v.projectAssignments
    : Array.isArray(v.project_assignments)
      ? v.project_assignments
      : [];
  const nestedPids = new Set();
  nestedAssignments.forEach((pa) => {
    const pid = pa?.projectId || pa?.project_id || '';
    if (!pid) return;
    nestedPids.add(pid);
    if (!grouped.has(pid)) grouped.set(pid, { projectId: pid, roles: [] });
    (Array.isArray(pa?.roles) ? pa.roles : []).forEach((r) => {
      grouped.get(pid).roles.push({
        role: fromRoleKey(r?.role),
        userIds: Array.isArray(r?.userIds)
          ? r.userIds
          : Array.isArray(r?.user_ids)
            ? r.user_ids
            : [],
      });
    });
  });
  flatAssignments.forEach((ua) => {
    const pid = ua?.project_id || ua?.projectId || '';
    if (!pid) return;
    // Skip projects already seeded from the nested projectAssignments
    // shape so we don't double up role rows.
    if (nestedPids.has(pid)) return;
    if (!grouped.has(pid)) grouped.set(pid, { projectId: pid, roles: [] });
    grouped.get(pid).roles.push({
      role: fromRoleKey(ua.role),
      userIds: Array.isArray(ua.user_ids)
        ? ua.user_ids
        : Array.isArray(ua.userIds)
          ? ua.userIds
          : [],
    });
    if (Array.isArray(ua?.users)) {
      ua.users.forEach((u) => {
        const uid = u?.id || u?.uuid;
        if (!uid || embeddedUsersById.has(uid)) return;
        const fullName =
          u.fullName ||
          u.full_name ||
          u.name ||
          u.login ||
          '';
        embeddedUsersById.set(uid, {
          userId: uid,
          userCode: u.userCode || u.user_code || '',
          fullName,
          employeeId: u.employeeId || u.employee_id || u.login || '',
          login: u.login || '',
          email: u.email || '',
        });
      });
    }
  });
  const assignmentUsers = Array.from(embeddedUsersById.values());
  // Projects that exist on the vendor but have no assignment rows yet —
  // surface them with empty default Admin/Member rows so the user can
  // fill them in without first re-adding the project mapping.
  projects.forEach((p) => {
    const pid = p?.id || p?.uuid;
    if (!pid || grouped.has(pid)) return;
    grouped.set(pid, {
      projectId: pid,
      roles: [
        { role: 'Project Admin', userIds: [] },
        { role: 'Project Member', userIds: [] },
      ],
    });
  });
  const projectAssignments = Array.from(grouped.values());

  return {
    vendorId: v.id || v.uuid || '',
    vendorCode: v.vendorCode || v.vendor_code || '',
    vendorName: v.name || '',
    description: v.description || '',
    status: v.active === false ? 'Inactive' : 'Active',
    vendorType: v.type || v.vendorType || 'Standard Vendor',
    contact: v.contactPerson || v.contact_person || v.contact || '',
    email: v.email || '',
    phone: v.phoneNumber || v.phone_number || v.phone || '',
    projectMapping: projects.map((p) => p.name).filter(Boolean),
    projectIds: projects.map((p) => p.id || p.uuid).filter(Boolean),
    projects,
    projectAssignments,
    assignmentUsers,
    createdAt: v.createdAt || '',
    updatedAt: v.updatedAt || '',
    startDate: (v.startDate || '').slice(0, 10),
    endDate: (v.endDate || '').slice(0, 10),
    address: v.address || '',
    services: v.services || '',
  };
}

export async function list() {
  const res = await api.get(ENDPOINTS.vendors.list);
  return unwrap(res).map(fromApi);
}

export async function get(id) {
  const res = await api.get(ENDPOINTS.vendors.get(id));
  return fromApi(unwrapOne(res));
}

export async function create({
  name,
  description,
  active = true,
  email,
  contact_person,
  phone_number,
  projectMapping,
}) {
  const res = await api.post(ENDPOINTS.vendors.create, {
    name,
    description,
    active,
    email,
    contact_person,
    phone_number,
    project_ids: Array.isArray(projectMapping) ? projectMapping : [],
  });
  return fromApi(unwrapOne(res));
}

export async function update(id, {
  name,
  description,
  active,
  email,
  contact_person,
  phone_number,
  // Flat list built by VendorDetails — one entry per (project, role, users)
  // tuple. Drives both `project_ids` (distinct project UUIDs) and
  // `user_assignments` in the outgoing payload, matching the backend
  // contract for PATCH /vendors/:id.
  assignments,
}) {
  const body = {};
  if (name !== undefined) body.name = name;
  if (description !== undefined) body.description = description;
  if (active !== undefined) body.active = active;
  if (email !== undefined) body.email = email;
  if (contact_person !== undefined) body.contact_person = contact_person;
  if (phone_number !== undefined) body.phone_number = phone_number;
  if (Array.isArray(assignments)) {
    const userAssignments = assignments
      .filter((a) => a && a.projectId)
      .map((a) => ({
        project_id: a.projectId,
        role: toRoleKey(a.role),
        user_ids: Array.isArray(a.userIds) ? a.userIds : [],
      }));
    // Distinct project UUIDs — same set as `user_assignments[].project_id`
    // but flattened to satisfy the `project_ids` array the backend expects
    // on the same payload.
    const seen = new Set();
    body.project_ids = userAssignments.reduce((acc, a) => {
      if (!seen.has(a.project_id)) {
        seen.add(a.project_id);
        acc.push(a.project_id);
      }
      return acc;
    }, []);
    body.user_assignments = userAssignments;
  }
  const res = await api.patch(ENDPOINTS.vendors.update(id), body);
  return fromApi(unwrapOne(res));
}

export async function remove(id) {
  return api.del(ENDPOINTS.vendors.remove(id));
}

// GET /api/v3/vendors/{id}/users — vendor-scoped user list. Returned in the
// same envelope as /users (paginated _embedded.elements), so reuse the user
// normalizer for shape parity with the global list.
export async function listUsers(id, { offset = 1, pageSize = 20, status } = {}) {
  const res = await api.get(ENDPOINTS.vendors.users(id), {
    query: { offset, pageSize, status },
  });
  return unwrap(res).map(userFromApi);
}
