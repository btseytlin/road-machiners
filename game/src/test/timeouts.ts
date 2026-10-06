// The factory runs the tests on a shared server, where every test runs several times slower and a time limit measures the load, not a hang.
// It sets TEST_TIMEOUTS=off there, so no test, hook or playtest step has a time limit. The factory's job time limit still stops a hung run.
export function timeoutsOff(): boolean {
  return process.env.TEST_TIMEOUTS === 'off';
}
