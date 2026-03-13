import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin, supabase } from '../supabase';

const router = Router();

// Validation schemas
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  display_name: z.string().min(1).max(50),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
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

    // Insert into our users table
    const { error: dbError } = await supabaseAdmin.from('users').insert({
      id: authData.user.id,
      email: body.email,
      display_name: body.display_name,
      role: 'member',
    });

    if (dbError) {
      console.error('Failed to insert user row:', dbError);
    }

    // Sign in using the PUBLIC client (not admin) to avoid contaminating admin client state
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: body.email,
      password: body.password,
    });

    if (signInError) {
      res.status(500).json({ success: false, error: 'Account created but sign-in failed. Please log in.' });
      return;
    }

    res.status(201).json({
      success: true,
      data: {
        user: {
          id: authData.user.id,
          email: body.email,
          display_name: body.display_name,
        },
        access_token: signInData.session!.access_token,
        refresh_token: signInData.session!.refresh_token,
      },
    });
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

// POST /auth/logout
router.post('/logout', async (req: Request, res: Response) => {
  // Client-side logout is sufficient (discard tokens)
  // Optionally revoke the refresh token on the server
  res.json({ success: true, message: 'Logged out' });
});

export default router;
