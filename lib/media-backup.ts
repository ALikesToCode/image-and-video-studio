export type UnsafeMediaBackup = {
  version: 1;
  updatedAt: string;
  records: unknown[];
};

const backupRecords = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  return record.version === 1 && Array.isArray(record.records)
    ? record.records
    : [];
};

const fingerprint = (value: unknown) => {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
};

export const mergeUnsafeMediaBackup = (
  existing: unknown,
  additions: unknown[],
  updatedAt = new Date().toISOString()
): UnsafeMediaBackup => {
  const records: unknown[] = [];
  const seen = new Set<string>();

  for (const value of [...backupRecords(existing), ...additions]) {
    const key = fingerprint(value);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    records.push(value);
  }

  return {
    version: 1,
    updatedAt,
    records,
  };
};
