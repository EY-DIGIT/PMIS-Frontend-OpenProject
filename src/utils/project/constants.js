export const NODE_TYPE_OPTIONS = ["Standard Type", "Resource Type", "Transactional Type"];
export const RESOURCE_TYPE_CODES = ["RFP", "ASG", "CCM"];
export const DIVISION_OPTIONS = ["TMD1", "TMD2", "Others"];
export const VENDOR_MASTER = ["Vendor A", "Vendor B", "Vendor C", "Vendor D", "Vendor E"];

export const DEP_KIND_LABEL = {
  milestone: "Milestone",
  activity: "Activity",
  task: "Task",
  subtask: "Sub-Task"
};

export const DEP_KIND_LABEL_PLURAL = {
  milestone: "Milestones",
  activity: "Activities",
  task: "Tasks",
  subtask: "Sub-Tasks"
};

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export const ALLOWED_DOCUMENT_EXTENSIONS = ["pdf", "docx", "xlsx", "txt", "csv"];
export const ALLOWED_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "heic"];
export const ALLOWED_VIDEO_EXTENSIONS = ["mp4", "webm", "mov"];

export const ALLOWED_FILE_EXTENSIONS = [
  ...ALLOWED_DOCUMENT_EXTENSIONS,
  ...ALLOWED_IMAGE_EXTENSIONS,
  ...ALLOWED_VIDEO_EXTENSIONS
];

export const ALLOWED_FILE_ACCEPT = ALLOWED_FILE_EXTENSIONS
  .map((ext) => `.${ext}`)
  .join(",");

export function getFileExtension(name) {
  const idx = String(name || "").lastIndexOf(".");
  return idx >= 0 ? String(name).slice(idx + 1).toLowerCase() : "";
}

export function isAllowedAttachment(file) {
  return ALLOWED_FILE_EXTENSIONS.includes(getFileExtension(file && file.name));
}
