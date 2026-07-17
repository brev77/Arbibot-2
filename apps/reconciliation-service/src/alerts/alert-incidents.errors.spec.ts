import { ConflictException, NotFoundException } from '@nestjs/common';

import { AlertIncidentNotFoundError } from './alert-incidents.errors';
import { AlertIncidentVersionMismatchError } from './alert-incidents.errors';

describe('AlertIncidentNotFoundError', () => {
  it('extends NotFoundException (HTTP 404) and carries the incident id', () => {
    const err = new AlertIncidentNotFoundError('inc-42');

    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.incidentId).toBe('inc-42');
    expect(err.name).toBe('AlertIncidentNotFoundError');
    expect(err.message).toMatch(/inc-42 not found/);
  });

  it('getStatus() returns 404', () => {
    expect(new AlertIncidentNotFoundError('x').getStatus()).toBe(404);
  });
});

describe('AlertIncidentVersionMismatchError', () => {
  it('extends ConflictException (HTTP 409) and carries version details', () => {
    const err = new AlertIncidentVersionMismatchError('inc-9', 3, 5);

    expect(err).toBeInstanceOf(ConflictException);
    expect(err.incidentId).toBe('inc-9');
    expect(err.expectedVersion).toBe(3);
    expect(err.actualVersion).toBe(5);
    expect(err.name).toBe('AlertIncidentVersionMismatchError');
  });

  it('getStatus() returns 409', () => {
    expect(
      new AlertIncidentVersionMismatchError('x', 1, 2).getStatus(),
    ).toBe(409);
  });

  it('response message mentions expected vs actual versions', () => {
    const err = new AlertIncidentVersionMismatchError('inc-1', 2, 7);
    const response = err.getResponse();

    // The response object carries the structured message + version fields
    // (used by the operator UI to render a stale-read hint).
    expect(response).toMatchObject({
      incidentId: 'inc-1',
      expectedVersion: 2,
      actualVersion: 7,
      message: expect.stringMatching(/expected 2.*actual 7/),
    });
  });
});
