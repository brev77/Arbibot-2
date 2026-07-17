import { PaperPromotionCriteriaController } from './paper-promotion-criteria.controller';
import { PaperPromotionService } from './paper-promotion.service';

/** PaperPromotionCriteriaController spec (Phase 4). */
describe('PaperPromotionCriteriaController', () => {
  let promotion: { getPromotionCriteria: jest.Mock };
  let controller: PaperPromotionCriteriaController;

  beforeEach(() => {
    promotion = { getPromotionCriteria: jest.fn() };
    controller = new PaperPromotionCriteriaController(
      promotion as unknown as PaperPromotionService,
    );
  });

  it('returns the promotion criteria from the service', () => {
    const criteria = {
      minSamples: 30,
      maxDriftBps: 30,
      minScore: 4,
    };
    promotion.getPromotionCriteria.mockReturnValue(criteria);

    const result = controller.getCriteria();

    expect(result).toBe(criteria);
    expect(promotion.getPromotionCriteria).toHaveBeenCalledTimes(1);
  });
});
