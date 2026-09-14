import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import sharp from "sharp"
import { parseKicadPcb } from "../../lib"

const MACOS_KICAD_CLI = "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli"
const KICAD_CLI =
  process.env["KICAD_CLI"] ??
  (existsSync(MACOS_KICAD_CLI) ? MACOS_KICAD_CLI : "kicad-cli")
const REAL_WORLD_BOARDS = [
  "CM5IO.kicad_pcb",
  "Cyclometer_v1.kicad_pcb",
  "OV5640-dual-camera-board.kicad_pcb",
  "corne-keyboard.kicad_pcb",
  "esp32-c3-iot-battery-pcb.kicad_pcb",
  "joule-thief.kicad_pcb",
]

async function renderRoundTripBoard(filename: string): Promise<Buffer> {
  const sourcePath = resolve(import.meta.dir, "..", "assets", filename)
  const source = await readFile(sourcePath, "utf8")
  const roundTrip = parseKicadPcb(source).getString()
  const tempDirectory = await mkdtemp(join(tmpdir(), "kicadts-visual-"))
  const pcbPath = join(tempDirectory, filename)
  const svgPath = join(tempDirectory, `${basename(filename, ".kicad_pcb")}.svg`)

  try {
    await writeFile(pcbPath, roundTrip)
    const process = Bun.spawn(
      [
        KICAD_CLI,
        "pcb",
        "export",
        "svg",
        pcbPath,
        "-o",
        svgPath,
        "--layers",
        "F.Cu,F.SilkS,Edge.Cuts",
        "--black-and-white",
        "--mode-single",
        "--page-size-mode",
        "2",
        "--exclude-drawing-sheet",
      ],
      { stderr: "pipe", stdout: "pipe" },
    )
    const exitCode = await process.exited
    if (exitCode !== 0) {
      throw new Error(
        `kicad-cli failed for ${filename}: ${await new Response(process.stderr).text()}`,
      )
    }

    return await sharp(await readFile(svgPath), { density: 120 })
      .resize({
        background: "white",
        fit: "contain",
        height: 600,
        width: 800,
      })
      .flatten({ background: "white" })
      .png()
      .toBuffer()
  } finally {
    await rm(tempDirectory, { force: true, recursive: true })
  }
}

for (const filename of REAL_WORLD_BOARDS) {
  test(`visually round-trips ${filename}`, async () => {
    await expect(renderRoundTripBoard(filename)).toMatchPngSnapshot(
      import.meta.path,
      basename(filename, ".kicad_pcb"),
    )
  }, 20_000)
}
