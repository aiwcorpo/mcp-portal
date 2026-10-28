import { readLoginError } from './session.service';

describe('readLoginError', () => {
  it.each(['cancelled', 'idp_error', 'session_expired', 'step_up_failed'])(
    'accepts the code %s',
    (code) => {
      expect(readLoginError(`?loginError=${code}`)).toBe(code);
    },
  );

  it.each(['?loginError=<script>', '?loginError=identity_mismatch', '?loginError=', '?x=1', ''])(
    'drops everything else (%s) so no unknown text reaches the login screen',
    (search) => {
      expect(readLoginError(search)).toBeNull();
    },
  );
});
