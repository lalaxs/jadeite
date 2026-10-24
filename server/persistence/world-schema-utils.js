/**
 * Shared primitives for validating persisted world snapshots.
 */
export function requireCanonicalId(value, label) {
  if (typeof value !== "string" || !value || value.trim() !== value) {
    throw new Error(`world-store: ${label} must be a canonical string id`);
  }
  return value;
}

export function validateUniqueRecordIds(records, label) {
  const ids = new Set();
  for (const record of records || []) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`world-store: invalid ${label} entry`);
    }
    const id = requireCanonicalId(record.id, `${label} entry id`);
    if (ids.has(id)) throw new Error(`world-store: duplicate ${label} entry ${id}`);
    ids.add(id);
  }
  return ids;
}

export function validateUniqueRecordField(records, field, label) {
  const values = new Set();
  for (const record of records || []) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`world-store: invalid ${label} entry`);
    }
    const value = requireCanonicalId(record[field], `${label} entry ${field}`);
    if (values.has(value)) {
      throw new Error(`world-store: duplicate ${label} entry ${value}`);
    }
    values.add(value);
  }
  return values;
}

export function requireArrayField(owner, field, label) {
  const value = owner?.[field];
  if (value != null && !Array.isArray(value)) {
    throw new Error(`world-store: ${label}.${field} must be an array`);
  }
  return value || [];
}

export function normalizeNonNegativeNumber(owner, field, label, { optional = false } = {}) {
  const present = Object.prototype.hasOwnProperty.call(owner || {}, field);
  if (!present && optional) return null;
  const raw = owner?.[field];
  if (
    raw == null
    || (typeof raw !== "number" && typeof raw !== "string")
    || (typeof raw === "string" && !raw.trim())
  ) {
    throw new Error(`world-store: ${label}.${field} must be a finite non-negative number`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`world-store: ${label}.${field} must be a finite non-negative number`);
  }
  // Numeric strings existed in early saves. Canonicalize them at the storage
  // boundary so later arithmetic cannot accidentally concatenate strings.
  owner[field] = value;
  return value;
}

export function normalizeNonNegativeInteger(owner, field, label, { optional = false, max } = {}) {
  const value = normalizeNonNegativeNumber(owner, field, label, { optional });
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || (max != null && value > max)) {
    const range = max != null ? ` between 0 and ${max}` : " a non-negative safe integer";
    throw new Error(`world-store: ${label}.${field} must be${range}`);
  }
  return value;
}


export function normalizeOptionalTimestamp(owner, field, label) {
  if (!Object.prototype.hasOwnProperty.call(owner || {}, field) || owner[field] == null) return null;
  return normalizeNonNegativeInteger(owner, field, label);
}

export function validateTimeOrder(owner, startField, endField, label) {
  const start = normalizeOptionalTimestamp(owner, startField, label);
  const end = normalizeOptionalTimestamp(owner, endField, label);
  if (start != null && end != null && end < start) {
    throw new Error(`world-store: ${label}.${endField} must not be before ${startField}`);
  }
  return { start, end };
}

export function validateAmountRows(owner, field, label) {
  const rows = requireArrayField(owner, field, label);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`world-store: invalid ${label}.${field}[${index}] entry`);
    }
    normalizeNonNegativeNumber(row, "amount", `${label}.${field}[${index}]`);
  }
  return rows;
}

export function validateFiniteNumbers(value, label = "snapshot", seen = new WeakSet()) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`world-store: ${label} must not contain a non-finite number`);
    }
    return;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      validateFiniteNumbers(value[index], `${label}[${index}]`, seen);
    }
    return;
  }
  for (const [field, nested] of Object.entries(value)) {
    validateFiniteNumbers(nested, `${label}.${field}`, seen);
  }
}

export function registerOwnedItem(ownedItems, item, label) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new Error(`world-store: invalid owned item at ${label}`);
  }
  const id = requireCanonicalId(item.id, `${label} item id`);
  const previous = ownedItems.get(id);
  if (previous) {
    throw new Error(`world-store: duplicate owned item ${id} at ${previous} and ${label}`);
  }
  ownedItems.set(id, label);
}


