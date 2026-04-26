import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin, supabase } from '../supabase';
import { getDefaultRoleIdForUserType } from '../utils/defaultRole';
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
      .select('id, role_id, user_type, client_id, expires_at, invited_by')
      .eq('email', body.email)
      .eq('status', 'pending')
      .maybeSingle();

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
      // Mark invitation as accepted
      await supabaseAdmin
        .from('invitations')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', invitation.id);

      // Add user to workspace with assigned role
      const { data: workspace } = await supabaseAdmin
        .from('workspaces')
        .select('id')
        .limit(1)
        .single();

      if (workspace) {
        let roleId = invitation.role_id;
        if (!roleId) {
          roleId = await getDefaultRoleIdForUserType(userType as UserType);
        }

        await supabaseAdmin.from('workspace_members').insert({
          workspace_id: workspace.id,
          user_id: authData.user.id,
          role: 'member',
          role_id: roleId,
        });
      }

      // If invitation links to a client, create the partner-client assignment
      if (invitation.client_id && (userType === 'partner' || userType === 'partner_employee' || userType === 'client' || userType === 'client_staff')) {
        await supabaseAdmin.from('partner_client_assignments').insert({
          user_id: authData.user.id,
          client_id: invitation.client_id,
        });
      }

      // If invitation links to a client with cash book access, create cash_book_users entry
      if (invitation.client_id) {
        const { data: cbAccess } = await supabaseAdmin
          .from('cash_book_client_access')
          .select('id')
          .eq('client_id', invitation.client_id)
          .eq('is_enabled', true)
          .maybeSingle();

        if (cbAccess) {
          // Check if this is the first cash book user for the client
          const { count } = await supabaseAdmin
            .from('cash_book_users')
            .select('*', { count: 'exact', head: true })
            .eq('client_id', invitation.client_id);

          await supabaseAdmin.from('cash_book_users').insert({
            user_id: authData.user.id,
            client_id: invitation.client_id,
            role: (count === 0) ? 'client_admin' : 'staff',
            invited_by: invitation.invited_by,
          });
        }
      }

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
    const { data, error } = await supabase.auth.signInWithPassword({
      email: body.email,
      password: body.password,
    });

    if (error) {
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

// POST /auth/logout
router.post('/logout', async (req: Request, res: Response) => {
  // Client-side logout is sufficient (discard tokens)
  // Optionally revoke the refresh token on the server
  res.json({ success: true, message: 'Logged out' });
});

export default router;
