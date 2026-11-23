import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const artifact = process.argv[2]
const target = 'wasm32-unknown-unknown'
const binary = fileURLToPath(new URL(`../target/${target}/release/${artifact}.wasm`, import.meta.url))
execFileSync('cargo', ['build', '--manifest-path', 'native/Cargo.toml', '--locked', '--release', '--target', target], { stdio: 'inherit' })
execFileSync('wasm-bindgen', [binary, '--target', 'nodejs', '--out-dir', 'wasm'], { stdio: 'inherit' })
writeFileSync('wasm/package.json', '{"type":"commonjs"}\n')
