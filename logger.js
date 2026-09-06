function write(level, message, meta) {
  const timestamp = new Date().toISOString();
  const metaStr = meta && Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
  const line = `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
  if (level === 'error') console.error(line);
  else console.log(line);
}

module.exports = {
  info: (message, meta) => write('info', message, meta),
  error: (message, meta) => write('error', message, meta),
};
