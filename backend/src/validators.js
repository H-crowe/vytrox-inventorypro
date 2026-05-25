export function httpError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

export function cleanString(value, max = 160) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

export function assertPositiveNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw httpError(`${name} must be a positive number.`);
  return number;
}

export function assertPositiveInt(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw httpError(`${name} must be a positive integer.`);
  return number;
}
