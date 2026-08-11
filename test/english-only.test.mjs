import { test } from "node:test"
import assert from "node:assert/strict"
import { assertEnglish } from "../lib/harness.mjs"

/**
 * Every word the engine burns into a frame is English. The guard has to catch
 * the mistake without firing on the things a recording legitimately names: a
 * host, a customer, a place.
 */

const rejects = text =>
  assert.throws(() => assertEnglish(text, "a step line"), /English only/)

const accepts = text =>
  assert.doesNotThrow(() => assertEnglish(text, "a step line"))

test("rejects a title written in Portuguese", () => {
  rejects("Depois · listagens no novo Design System")
  rejects("Antes da migração")
})

test("rejects a Portuguese step line", () => {
  rejects("clicar no botão de salvar")
  rejects("a página não carregou")
})

test("rejects Spanish too", () => {
  rejects("abre la pantalla porque el usuario lo pide")
})

test("accepts ordinary English", () => {
  accepts("After · listings on the new Design System")
  accepts("open the organizations listing")
  accepts("the list runs 410px past the screen")
  accepts("switch back to cards")
})

// A hostname is an identifier, not prose: ".com" is not the Portuguese "com",
// and a recording that notes its origin must not be blocked by it.
test("does not trip on urls and hostnames", () => {
  accepts("origin https://active.stg.wellzesta.com · desktop")
  accepts("origin http://localhost:4000 · mobile")
  accepts("resolved href /organizations/445")
})

// Data the app under test renders is quoted in notes all the time.
test("does not trip on names the app happens to render", () => {
  accepts("row reads Acme Corp — Florianopolis, SC")
  accepts("attending: Nelso Jost")
})

test("names where the offending text came from", () => {
  assert.throws(
    () => assertEnglish("não", "the recording title"),
    /the recording title/
  )
})
