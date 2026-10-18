// Hämtar den senaste imagen och startar om appen på TrueNAS (som "Pull images" i TrueNAS).
// Körs av .github/workflows/server-image.yml när en ny server-image har lagts upp. Se server/README.md.
// Pratar med TrueNAS JSON-RPC-API över websocket, som finns från TrueNAS 25.04.
//
//   TRUENAS_URL      adressen till TrueNAS webbgränssnitt, t.ex. https://truenas.tail.elmarsson.se
//   TRUENAS_API_KEY  en API-nyckel från TrueNAS
//   TRUENAS_APP      appens namn i TrueNAS (standard: matpref)

const { TRUENAS_URL, TRUENAS_API_KEY, TRUENAS_APP = 'matpref' } = process.env
const timeoutMs = 10 * 60 * 1000

if (!TRUENAS_URL || !TRUENAS_API_KEY) {
  console.error('TRUENAS_URL och TRUENAS_API_KEY måste vara satta.')
  process.exit(1)
}

const url = new URL('/api/current', TRUENAS_URL)
// TrueNAS spärrar en API-nyckel som skickas okrypterat, så http godtas inte.
if (url.protocol !== 'https:') {
  console.error(`TRUENAS_URL måste börja med https:// (var ${url.protocol}//).`)
  process.exit(1)
}
url.protocol = 'wss:'

setTimeout(() => {
  console.error(`Gav upp efter ${timeoutMs / 60000} minuter.`)
  process.exit(1)
}, timeoutMs).unref()

const ws = new WebSocket(url)
const pending = new Map()
let nextId = 1

ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data)
  const p = pending.get(msg.id)
  if (!p) return
  pending.delete(msg.id)
  if (msg.error) {
    const reason = msg.error.data?.reason ?? msg.error.message
    p.reject(new Error(`${p.method}: ${reason}`))
  } else {
    p.resolve(msg.result)
  }
})
ws.addEventListener('close', (e) => {
  for (const p of pending.values()) p.reject(new Error(`Anslutningen till TrueNAS stängdes (${e.code}).`))
  pending.clear()
})

const opened = new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', () => reject(new Error(
    `Kunde inte ansluta till ${url}. Kolla adressen, att den nås via Tailscale och att certifikatet är giltigt ` +
    '(eller sätt TRUENAS_SKIP_TLS_VERIFY till true för TrueNAS eget självsignerade).',
  )), { once: true })
})

const call = (method, params = []) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { method, resolve, reject })
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
  })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  await opened
  if (!(await call('auth.login_with_api_key', [TRUENAS_API_KEY]))) throw new Error('TrueNAS godtog inte API-nyckeln.')

  console.log(`Hämtar imagen och startar om ${TRUENAS_APP} …`)
  const jobId = await call('app.pull_images', [TRUENAS_APP, { redeploy: true }])

  let last = ''
  for (;;) {
    const [job] = await call('core.get_jobs', [[['id', '=', jobId]]])
    const line = `${job.progress?.percent ?? 0}% ${job.progress?.description ?? ''}`.trim()
    if (line !== last) console.log(line)
    last = line
    if (job.state === 'SUCCESS') break
    if (job.state === 'FAILED' || job.state === 'ABORTED') throw new Error(job.error ?? `jobbet slutade med ${job.state}`)
    await sleep(2000)
  }

  console.log(`${TRUENAS_APP} kör nu den senaste imagen.`)
  ws.close()
} catch (e) {
  console.error(e.message)
  process.exit(1)
}
