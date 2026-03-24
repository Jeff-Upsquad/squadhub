import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../supabase';

const router = Router();

// POST /clients/onboard — public onboarding form submission (no auth)
const onboardSchema = z.object({
  business_name: z.string().min(1).max(200),
  contact_person: z.string().min(1).max(200),
  designation: z.string().max(200).optional(),
  contact_number: z.string().min(1).max(20),
  email: z.string().email(),
  business_address: z.string().min(1).max(1000),
  gst_registered: z.boolean(),
  gst_number: z.string().max(50).optional(),
  accounts_email: z.string().email().optional().or(z.literal('')),
});

router.post('/onboard', async (req: Request, res: Response) => {
  try {
    const body = onboardSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('client_submissions')
      .insert({
        business_name: body.business_name,
        contact_person: body.contact_person,
        designation: body.designation || null,
        contact_number: body.contact_number,
        email: body.email,
        business_address: body.business_address,
        gst_registered: body.gst_registered,
        gst_number: body.gst_registered ? (body.gst_number || null) : null,
        accounts_email: body.accounts_email || null,
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Client onboarding error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
