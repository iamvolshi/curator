// The panel's seats and its bank.
//
// What these check without a key and without a network: that a panel is three
// seats and each seat is a plug through the one seam, that seat 1 is Muse through
// the meta plug, that the two free seats stay unseated until someone names their
// models rather than picking them here, that the bank is free-first and
// configurable, and that an unseated panel is refused as configuration rather than
// discovered as a failed call.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkPlugShape, resolvePlug } from '../provider/index.js';
import {
  BANK_ENV,
  DEFAULT_BANK,
  SEATS,
  bankOption,
  describeSeat,
  panelBank,
  panelConfig,
  panelProblem,
} from '../judge/seats.js';

/** A panel someone has actually seated: Muse in seat 1, two free models beside it. */
const SEATED = {
  MODEL_API_KEY: 'LLM_test_key',
  NVIDIA_API_KEY: 'nvapi-test-key',
  PANEL_SEAT2_MODEL: 'a-free-model',
  PANEL_SEAT3_MODEL: 'another-free-model',
};

test('a panel is three seats, and every seat is a plug through the seam', () => {
  const { seats } = panelConfig(SEATED);

  assert.equal(SEATS, 3);
  assert.deepEqual(seats.map((seat) => seat.seat), [1, 2, 3], 'the seats are numbered in order');
  for (const seat of seats) {
    assert.equal(seat.plug.name, seat.plugName);
    assert.equal(checkPlugShape(seat.plug).length, 0, `seat ${seat.seat} is served by a well-shaped plug`);
  }
});

test('seat 1 is Muse through the existing meta plug', () => {
  const [first] = panelConfig(SEATED).seats;

  assert.equal(first.plugName, 'meta');
  assert.equal(first.model, 'muse-spark-1.3', 'Meta\u2019s documented default, not a name chosen here');
  assert.equal(first.modelEnvVar, null, 'the main seat has no separate model variable');
  assert.equal(first.plug.role, 'worker', 'the plug keeps its own role: it is the Worker\u2019s plug');
});

test('the free seats are wired but not seated until someone names their models', () => {
  const bare = panelConfig({ MODEL_API_KEY: 'LLM_test_key' });
  const [one, two, three] = bare.seats;

  assert.equal(one.model, 'muse-spark-1.3', 'the main seat is seated by the plug\u2019s own default');
  assert.equal(two.plugName, 'nvidia');
  assert.equal(two.model, null, 'no free model is chosen here');
  assert.equal(two.modelEnvVar, 'PANEL_SEAT2_MODEL');
  assert.equal(three.model, null);
  assert.equal(three.modelEnvVar, 'PANEL_SEAT3_MODEL');

  const problem = panelProblem(bare, { MODEL_API_KEY: 'LLM_test_key' });
  assert.equal(problem.where, 'seat');
  assert.equal(problem.seat, 2);
  assert.equal(problem.status, 'needs-config');
  assert.match(problem.missing, /PANEL_SEAT2_MODEL/, 'the refusal names the variable to set');
  assert.match(problem.keyProblem, /NVIDIA_API_KEY/, 'and the key that is also missing, so both are found in one run');
});

test('a seated panel has no problem, and its seats name different models', () => {
  const config = panelConfig(SEATED);

  assert.equal(panelProblem(config, SEATED), null);
  assert.deepEqual(
    config.seats.map((seat) => seat.model),
    ['muse-spark-1.3', 'a-free-model', 'another-free-model'],
  );
  assert.equal(new Set(config.seats.map((seat) => seat.model)).size, 3, 'three seats, three models');
});

test('a seat\u2019s model comes from its own variable, or from the plug it is served by', () => {
  // A seat moved to a plug that already has a model is seated by that model: the
  // seat variable is a decision, not a requirement.
  const env = {
    MODEL_API_KEY: 'LLM_test_key',
    OPENROUTER_BASE_URL: 'https://example.test/v1',
    OPENROUTER_API_KEY: 'router-secret',
    OPENROUTER_MODEL: 'a-router-model',
    PANEL_SEAT2_PLUG: 'openrouter',
    PANEL_SEAT3_MODEL: 'a-free-model',
    NVIDIA_API_KEY: 'nvapi-test-key',
  };
  const config = panelConfig(env);

  assert.equal(config.seats[1].plugName, 'openrouter');
  assert.equal(config.seats[1].model, 'a-router-model');
  assert.equal(panelProblem(config, env), null, 'the panel is seated without a separate seat variable');
});

test('a seat whose plug cannot be called stops the run, and the key is named', () => {
  const config = panelConfig({ PANEL_SEAT2_MODEL: 'a-free-model', PANEL_SEAT3_MODEL: 'another-free-model' });
  const problem = panelProblem(config, { PANEL_SEAT2_MODEL: 'a-free-model', PANEL_SEAT3_MODEL: 'another-free-model' });

  assert.equal(problem.where, 'seat');
  assert.equal(problem.seat, 1, 'the first unseated seat is the one reported');
  assert.match(problem.missing, /seat 1 cannot be called/);
  assert.match(problem.missing, /MODEL_API_KEY/);
  assert.equal(problem.keyProblem, null, 'one problem, named once');

  const withoutTheFreeKey = panelProblem(panelConfig(SEATED), {
    MODEL_API_KEY: 'LLM_test_key',
    PANEL_SEAT2_MODEL: 'a-free-model',
    PANEL_SEAT3_MODEL: 'another-free-model',
  });
  assert.equal(withoutTheFreeKey.seat, 2, 'seat 2 is seated by its own model and its key is what is missing');
  assert.match(withoutTheFreeKey.missing, /NVIDIA_API_KEY/);
});

test('the bank is free-first by default, configurable, and may be emptied on purpose', () => {
  assert.deepEqual([...DEFAULT_BANK], ['nvidia', 'openrouter']);
  assert.deepEqual(panelBank({}), ['nvidia', 'openrouter'], 'saying nothing gets the default');
  assert.deepEqual(panelBank({ [BANK_ENV]: 'openrouter, nvidia' }), ['openrouter', 'nvidia'], 'the order is the order given');
  assert.deepEqual(panelBank({ [BANK_ENV]: '' }), [], 'an empty bank is an answer: no failover');
  assert.deepEqual(panelBank({ [BANK_ENV]: 'nvidia,, ' }), ['nvidia'], 'blank entries are not plugs');

  const paid = panelProblem(panelConfig({ ...SEATED, [BANK_ENV]: 'baseten' }), SEATED);
  assert.equal(paid, null, 'a paid plug in the bank is allowed — it is a decision, not an error');
});

test('a bank name that is not a plug is refused as configuration, not discovered as a failure', () => {
  const config = panelConfig({ ...SEATED, [BANK_ENV]: 'nvidia,florida' });
  const problem = panelProblem(config, SEATED);

  assert.equal(problem.where, 'bank');
  assert.equal(problem.seat, null);
  assert.match(problem.missing, /"florida"/);
  assert.match(problem.missing, /the plugs are/);
});

test('a bank plug that cannot be called is a seat that stays empty, with a reason', () => {
  const ready = bankOption('nvidia', { NVIDIA_API_KEY: 'nvapi-test-key', NVIDIA_MODEL: 'a-free-model' });
  assert.equal(ready.ready, true);
  assert.equal(ready.model, 'a-free-model');
  assert.equal(ready.problem, null);

  const noModel = bankOption('nvidia', { NVIDIA_API_KEY: 'nvapi-test-key' });
  assert.equal(noModel.ready, false);
  assert.match(noModel.problem, /NVIDIA_MODEL/, 'the plug says what is missing, in its own words');

  // A plug with a model but no key: it cannot fill a seat, and the reason is the key.
  const noKey = bankOption('openrouter', { OPENROUTER_BASE_URL: 'https://example.test/v1', OPENROUTER_MODEL: 'a-model' });
  assert.equal(noKey.ready, false);
  assert.match(noKey.problem, /OPENROUTER_API_KEY/);

  assert.equal(bankOption('openrouter', {
    OPENROUTER_BASE_URL: 'https://example.test/v1',
    OPENROUTER_API_KEY: 'router-secret',
    OPENROUTER_MODEL: 'a-model',
  }).ready, true);
});

test('a seat reads as one plain line, model and source included', () => {
  const lines = panelConfig(SEATED).seats.map(describeSeat);

  assert.match(lines[0], /seat 1 \u2014 meta using muse-spark-1\.3/);
  assert.match(lines[1], /seat 2 \u2014 nvidia using a-free-model via PANEL_SEAT2_MODEL/);
  assert.equal(lines.length, 3);
});

/**
 * The panel the shipped example configuration seats, as a reader of that file
 * would get it. Only names are read here; no value in it is a secret.
 */
async function exampleEnv() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const text = await readFile(join(root, '.env.example'), 'utf8');
  const env = {};
  for (const line of text.split('\n')) {
    const found = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (found) env[found[1]] = found[2].trim();
  }
  return env;
}

test('the example configuration seats three judges on three different models', async () => {
  // Independence is counted by model ID, so a shipped example that seated two seats
  // on one model would hand a reader a panel that reads three judges and holds one.
  // Seat 1 is Muse, so Muse's own family is not a second judge either.
  // The example cannot hold keys, so the keys are supplied here: what is being read
  // is the seating, which is what a reader copies.
  const env = { ...(await exampleEnv()), MODEL_API_KEY: 'a-key', NVIDIA_API_KEY: 'a-key' };
  const config = panelConfig(env);

  assert.equal(panelProblem(config, env), null, 'the example seats a panel that is callable once a key is in place');

  const models = config.seats.map((seat) => seat.model);
  assert.equal(new Set(models).size, 3, `the example seats three distinct models; it seats ${JSON.stringify(models)}`);

  for (const option of config.bank.map((name) => bankOption(name, env)).filter((each) => each.ready)) {
    assert.equal(
      models.includes(option.model),
      false,
      `the bank's ${option.model} is already a seat's own model, so it could only ever be skipped as a fill`,
    );
  }
});

test('the nvidia plug keeps NVIDIA\u2019s own published facts, and no invented model', () => {
  const bare = resolvePlug('nvidia', {});

  assert.deepEqual(checkPlugShape(bare), []);
  assert.equal(bare.baseUrl, 'https://integrate.api.nvidia.com/v1');
  assert.equal(bare.chatUrl, 'https://integrate.api.nvidia.com/v1/chat/completions');
  assert.equal(bare.keyEnvVar, 'NVIDIA_API_KEY');
  assert.equal(bare.role, 'judge');
  assert.equal(bare.defaultModel, null, 'no free model is picked here');
  assert.equal(bare.status, 'needs-config');
  assert.equal(bare.statusUrl, null, 'no health address is invented for it');
  assert.match(bare.sources.baseUrl, /forums\.developer\.nvidia\.com/, 'the address says where it came from');
  assert.match(bare.blockedReason, /NVIDIA_MODEL/);

  const named = resolvePlug('nvidia', { NVIDIA_MODEL: 'a-free-model' });
  assert.equal(named.status, 'ready');
  assert.equal(named.model, 'a-free-model');
});
