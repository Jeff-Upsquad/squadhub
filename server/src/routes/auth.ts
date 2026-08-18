import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin, supabase } from '../supabase';
import {
  applyAcceptedInvitation,
  INVITATION_COLUMNS,
  type PendingInvitation,
} from '../utils/applyInvitation';
import { seedSquadhireClientLogin } from '../utils/seedSquadhireClientLogin';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../utils/rateLimit';
import * as passwordReset from '../services/passwordReset';
import type { UserType } from '@squadhub/shared';

const router = Router();

// Validation schemas
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  display_name: z.string().min(1).max(50),
  user_type: z.enum(['internal', 'client', 'client_staff', 'partner', 'partner_employee']).optional().default('internal'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refresh_token: z.string().min(1),
});

// POST /auth/register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const body = registerSchema.parse(req.body);

    // Create user in Supabase Auth (admin API for user creation)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true, // Auto-confirm for now
      user_metadata: { display_name: body.display_name },
    });

    if (authError) {
      res.status(400).json({ success: false, error: authError.message });
      return;
    }

    // Check if this email has a pending, non-expired invitation
    const { data: invitation } = await supabaseAdmin
      .from('invitations')
      .select(INVITATION_COLUMNS)
      .eq('email', body.email)
      .eq('status', 'pending')
      .maybeSingle<PendingInvitation & { expires_at: string }>();

    const isInvited = invitation && new Date(invitation.expires_at) > new Date();

    // User type comes from invitation (if invited) or request body
    const userType = isInvited ? invitation.user_type : body.user_type;

    // Insert into our users table
    const { error: dbError } = await supabaseAdmin.from('users').insert({
      id: authData.user.id,
      email: body.email,
      display_name: body.display_name,
      status: isInvited ? 'active' : 'pending',
      user_type: userType,
    });

    if (dbError) {
      console.error('Failed to insert user row:', dbError);
    }

    // If invited: auto-approve, assign role, add to workspace
    if (isInvited) {
      await applyAcceptedInvitation({
        userId: authData.user.id,
        userType: userType as UserType,
        invitation,
      });

      res.status(201).json({
        success: true,
        invited: true,
        message: 'Your signup has been approved! You can now proceed to the login page.',
      });
    } else {
      // Standard flow — account needs admin approval
      res.status(201).json({
        success: true,
        invited: false,
        message: 'Account created. Awaiting admin approval.',
      });
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Register error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const body = loginSchema.parse(req.body);

    // Use the PUBLIC client for signInWithPassword (not admin) to avoid contaminating admin client
    let { data, error } = await supabase.auth.signInWithPassword({
      email: body.email,
      password: body.password,
    });

    // A SquadHire business user signing in here for the first time has no
    // SquadHub account yet — only a pending client invitation. If the password
    // they typed is their real SquadHire password, create the account with it
    // and sign in for real. Only reachable after a failed sign-in, and the
    // retry below is what actually authenticates.
    if (error) {
      const seeded = await seedSquadhireClientLogin({
        email: body.email,
        password: body.password,
      });
      if (seeded) {
        ({ data, error } = await supabase.auth.signInWithPassword({
          email: body.email,
          password: body.password,
        }));
      }
    }

    if (error || !data?.user) {
      res.status(401).json({ success: false, error: 'Invalid email or password' });
      return;
    }

    // Fetch user profile from our users table (admin client for DB query is fine)
    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', data.user.id)
      .single();

    // Check user approval status
    if (profile?.status === 'pending') {
      res.status(403).json({ success: false, error: 'Your account is pending admin approval.' });
      return;
    }
    if (profile?.status === 'rejected') {
      res.status(403).json({ success: false, error: 'Your account has been rejected.' });
      return;
    }
    if (profile?.status === 'banned') {
      res.status(403).json({ success: false, error: 'Your account has been banned.' });
      return;
    }
    if (profile?.status === 'suspended') {
      res.status(403).json({ success: false, error: 'Your account has been suspended.' });
      return;
    }

    res.json({
      success: true,
      data: {
        user: profile || {
          id: data.user.id,
          email: data.user.email,
          display_name: data.user.user_metadata?.display_name || 'User',
        },
        access_token: data.session!.access_token,
        refresh_token: data.session!.refresh_token,
        // Set by self-serve reset and by admin Users → Reset password.
        // Clients must collect a new password before entering the app.
        must_reset_password: data.user.user_metadata?.must_reset_password === true,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /auth/refresh
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const body = refreshSchema.parse(req.body);

    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: body.refresh_token,
    });

    if (error || !data.session) {
      res.status(401).json({ success: false, error: 'Session expired' });
      return;
    }

    res.json({
      success: true,
      data: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Refresh error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ─── Self-serve password reset (phone → WhatsApp temp password) ─────────────
// See services/passwordReset.ts. These are unauthenticated and hand out a live
// credential, so each step is rate-limited by IP on top of the per-ticket
// attempt cap in the service.

const resetLookupSchema = z.object({ phone: z.string().trim().min(6).max(24) });
const resetSendSchema = z.object({ reset_ticket: z.string().min(1) });
const resetVerifySchema = z.object({
  reset_ticket: z.string().min(1),
  temp_password: z.string().trim().min(1).max(64),
});
const changePasswordSchema = z.object({
  new_password: z.string().min(8, 'Password must be at least 8 characters'),
});

function handleResetError(err: unknown, res: Response, label: string): void {
  if (err instanceof z.ZodError) {
    res.status(400).json({ success: false, error: err.errors[0].message });
    return;
  }
  if (err instanceof passwordReset.PasswordResetError) {
    res.status(err.status).json({ success: false, error: err.message });
    return;
  }
  console.error(`${label} error:`, err);
  res.status(500).json({ success: false, error: 'Internal server error' });
}

// POST /auth/password-reset/lookup — phone → masked hint + reset ticket.
router.post(
  '/password-reset/lookup',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }),
  async (req: Request, res: Response) => {
    try {
      const body = resetLookupSchema.parse(req.body);
      const result = await passwordReset.lookupAccountByPhone(body.phone);
      res.json({ success: true, data: result });
    } catch (err) {
      handleResetError(err, res, 'Password reset lookup');
    }
  },
);

// POST /auth/password-reset/send — mint + apply a temp password, WhatsApp it.
router.post(
  '/password-reset/send',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 5 }),
  async (req: Request, res: Response) => {
    try {
      const body = resetSendSchema.parse(req.body);
      const result = await passwordReset.sendTempPassword(body.reset_ticket);
      res.json({ success: true, data: result });
    } catch (err) {
      handleResetError(err, res, 'Password reset send');
    }
  },
);

// POST /auth/password-reset/verify — exchange the temp password for a session.
router.post(
  '/password-reset/verify',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 15 }),
  async (req: Request, res: Response) => {
    try {
      const body = resetVerifySchema.parse(req.body);
      const result = await passwordReset.verifyTempPassword(
        body.reset_ticket,
        body.temp_password,
      );
      res.json({ success: true, data: result });
    } catch (err) {
      handleResetError(err, res, 'Password reset verify');
    }
  },
);

// POST /auth/change-password — set a new password for the signed-in user and
// clear the must_reset_password flag. The last step of the reset flow, and
// usable on its own from account settings.
router.post('/change-password', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = changePasswordSchema.parse(req.body);
    const { error } = await supabaseAdmin.auth.admin.updateUserById(req.userId as string, {
      password: body.new_password,
      user_metadata: { must_reset_password: false },
    });
    if (error) {
      res.status(400).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, message: 'Password updated' });
  } catch (err) {
    handleResetError(err, res, 'Change password');
  }
});

// POST /auth/logout
router.post('/logout', async (req: Request, res: Response) => {
  // Client-side logout is sufficient (discard tokens)
  // Optionally revoke the refresh token on the server
  res.json({ success: true, message: 'Logged out' });
});

export default router;
