import { createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import yazl from 'yazl'
export async function makeZip(destination, entries) {
  const zip = new yazl.ZipFile()
  for (const [name, content] of entries) zip.addBuffer(Buffer.from(content), name)
  zip.end()
  await pipeline(zip.outputStream, createWriteStream(destination))
}
export async function fixtureEntries() {
  const entries = []
  async function visit(folder, relative = '') {
    for (const item of await readdir(folder, { withFileTypes: true })) {
      const name = relative ? `${relative}/${item.name}` : item.name
      if (item.isDirectory()) await visit(join(folder, item.name), name)
      else entries.push([name, await readFile(join(folder, item.name))])
    }
  }
  await visit(resolve('fixtures/sum'))
  return entries
}
if (process.argv[1]?.endsWith('fixture.mjs')) {
  await mkdir('.qa', { recursive: true })
  await makeZip(resolve('fixtures/sum-of-two-numbers.zip'), await fixtureEntries())
  console.log('Created fixtures/sum-of-two-numbers.zip')
}
