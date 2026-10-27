import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({updates:[] as any[],fanout:vi.fn(),card:{id:'brief',state:'draft',service_type:'Unmapped fixture service',squadhire_category_ids:['category'],target_tiers:['Pro'],tier_pricing:{Pro:{proposed_price:0,subscription_price:100}},publish_targets:['talent'],card_type:'subscription'}}));
vi.mock('../supabase',()=>({supabaseAdmin:{from:()=>{
  const q:any={select(){return q;},eq(){return q;},update(patch:any){m.updates.push(patch);return q;},maybeSingle:async()=>({data:m.card,error:null}),limit:async()=>({data:[],error:null})};return q;
}}}));
vi.mock('../utils/subscriptionCards',()=>({fanOutTierCards:m.fanout,matchPartnersForCard:vi.fn()}));
vi.mock('../utils/cardEvents',()=>({logCardEvent:vi.fn()}));
vi.mock('../utils/subscriptionFormPricing',async(importOriginal)=>({...(await importOriginal<any>()),expandBroadcastTiersForPublish:async()=>({targetTiers:['Pro','Junior'],tierPricing:{Pro:{proposed_price:0,subscription_price:100},Junior:{proposed_price:0,subscription_price:null,markup:null}}})}));
import { publishRequirementCard } from '../utils/publishRequirementCard';
beforeEach(()=>{m.updates=[];m.fanout.mockReset();});
it('a failed tier publication preserves the business selected levels and quote intent for its retry',async()=>{
  m.fanout.mockRejectedValue(new Error('temporary database failure'));
  await expect(publishRequirementCard('brief',null,'broadcast')).rejects.toThrow('temporary database failure');
  expect(m.updates.some(p=>p.target_tiers || p.tier_pricing)).toBe(false);
  expect(m.card.target_tiers).toEqual(['Pro']);
  expect(m.fanout).toHaveBeenCalledWith('brief',null,'broadcast',{
    targetTiers:['Pro','Junior'],
    tierPricing:{Pro:{proposed_price:0,subscription_price:100},Junior:{proposed_price:0,subscription_price:null,markup:null}},
  });
});
