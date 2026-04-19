import { BadRequestException } from '@nestjs/common';

import { PartialFillPlaybookService } from './partial-fill-playbook.service';

describe('PartialFillPlaybookService', () => {
  const svc = new PartialFillPlaybookService();

  it('accepts empty config', () => {
    expect(svc.parse(null)).toEqual({});
  });

  it('parses valid playbook', () => {
    expect(
      svc.parse({
        partialFillStrategy: 'hedge',
        driftBpsThreshold: 25,
        maxPartialLegCommits: 3,
      }),
    ).toEqual({
      partialFillStrategy: 'hedge',
      driftBpsThreshold: 25,
      maxPartialLegCommits: 3,
    });
  });

  it('rejects invalid strategy', () => {
    expect(() => svc.parse({ partialFillStrategy: 'nope' })).toThrow(
      BadRequestException,
    );
  });
});
