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

async function renderPcbView({
  bottom,
  filename,
  pcbPath,
  tempDirectory,
}: {
  bottom: boolean
  filename: string
  pcbPath: string
  tempDirectory: string
}): Promise<Buffer> {
  const side = bottom ? "bottom" : "top"
  const svgPath = join(
    tempDirectory,
    `${basename(filename, ".kicad_pcb")}-${side}.svg`,
  )
  const layers = bottom ? "B.Cu,B.SilkS,Edge.Cuts" : "F.Cu,F.SilkS,Edge.Cuts"
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
      layers,
      ...(bottom ? ["--mirror"] : []),
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
      `kicad-cli failed for ${filename} ${side}: ${await new Response(process.stderr).text()}`,
    )
  }

  return await sharp(await readFile(svgPath), { density: 120 })
    .resize({
      background: "white",
      fit: "contain",
      height: 450,
      width: 600,
    })
    .flatten({ background: "white" })
    .png()
    .toBuffer()
}

async function stackViews(views: Buffer[]): Promise<Buffer> {
  return await sharp({
    create: {
      width: 1200,
      height: 900,
      channels: 3,
      background: "white",
    },
  })
    .composite(
      views.map((input, index) => ({
        input,
        left: (index % 2) * 600,
        top: Math.floor(index / 2) * 450,
      })),
    )
    .png()
    .toBuffer()
}

async function renderSourceAndRoundTripBoard(
  filename: string,
): Promise<Buffer> {
  const sourcePath = resolve(import.meta.dir, "..", "assets", filename)
  const source = await readFile(sourcePath, "utf8")
  const roundTrip = parseKicadPcb(source).getString()
  const tempDirectory = await mkdtemp(join(tmpdir(), "kicadts-visual-"))
  const sourcePcbPath = join(tempDirectory, `source-${filename}`)
  const roundTripPcbPath = join(tempDirectory, `roundtrip-${filename}`)

  try {
    await Promise.all([
      writeFile(sourcePcbPath, source),
      writeFile(roundTripPcbPath, roundTrip),
    ])
    return await stackViews(
      await Promise.all([
        renderPcbView({
          bottom: false,
          filename: `source-${filename}`,
          pcbPath: sourcePcbPath,
          tempDirectory,
        }),
        renderPcbView({
          bottom: false,
          filename: `roundtrip-${filename}`,
          pcbPath: roundTripPcbPath,
          tempDirectory,
        }),
        renderPcbView({
          bottom: true,
          filename: `source-${filename}`,
          pcbPath: sourcePcbPath,
          tempDirectory,
        }),
        renderPcbView({
          bottom: true,
          filename: `roundtrip-${filename}`,
          pcbPath: roundTripPcbPath,
          tempDirectory,
        }),
      ]),
    )
  } finally {
    await rm(tempDirectory, { force: true, recursive: true })
  }
}

for (const filename of REAL_WORLD_BOARDS) {
  test(`visually preserves both sides of ${filename}`, async () => {
    await expect(renderSourceAndRoundTripBoard(filename)).toMatchPngSnapshot(
      import.meta.path,
      basename(filename, ".kicad_pcb"),
    )
  }, 60_000)
}
