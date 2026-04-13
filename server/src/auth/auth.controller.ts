import {
  Controller, Get, Post, Put, Body, Req, Res, Param,
  UseGuards, UseInterceptors, UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { unlink } from 'fs/promises';
import { Public } from './decorators';
import { RegisterDto, LoginDto, UpdateProfileDto } from './auth.dto';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { TeamService } from '../team/team.service';

@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly team: TeamService,
    private readonly config: ConfigService,
  ) {}

  /** Редирект на Google OAuth */
  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleLogin() {}

  /** Callback от Google */
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  googleCallback(@Req() req: any, @Res() res: Response) {
    const token = this.auth.issueToken(req.user);
    const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3001';
    res.redirect(`${frontendUrl}/auth/callback?token=${token}`);
  }

  /** Регистрация через email/пароль */
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto.email, dto.password);
  }

  /** Вход через email/пароль */
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.loginWithPassword(dto.email, dto.password);
  }

  /** Профиль текущего пользователя */
  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  me(@Req() req: any) {
    return this.auth.getMe(req.user.userId);
  }

  /** Обновление профиля */
  @Put('me')
  @UseGuards(AuthGuard('jwt'))
  updateMe(@Req() req: any, @Body() dto: UpdateProfileDto) {
    return this.auth.updateMe(req.user.userId, { name: dto.name, tenantName: dto.tenantName });
  }

  /** Загрузка логотипа/аватара */
  @Post('me/avatar')
  @UseGuards(AuthGuard('jwt'))
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: join(__dirname, '..', '..', 'public', 'uploads'),
        // Уникальное имя через timestamp — URL каждый раз новый, браузер не кэширует старое
        filename: (_req, file, cb) => {
          const userId = (_req as any).user?.userId ?? 'unknown';
          cb(null, `${userId}_${Date.now()}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.match(/^image\//)) {
          cb(new BadRequestException('Только изображения'), false);
        } else {
          cb(null, true);
        }
      },
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  async uploadAvatar(@Req() req: any, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Файл не загружен');

    const serverUrl = this.config.get<string>('SERVER_URL') ?? 'http://localhost:3001';
    const uploadsPrefix = `${serverUrl}/public/uploads/`;

    // Удаляем старый файл если он был локальным (не Google OAuth URL)
    const current = await this.auth.getMe(req.user.userId);
    if (current.avatarUrl?.startsWith(uploadsPrefix)) {
      const oldFilename = current.avatarUrl.slice(uploadsPrefix.length);
      const oldPath = join(__dirname, '..', '..', 'public', 'uploads', oldFilename);
      await unlink(oldPath).catch(() => {});
    }

    const avatarUrl = `${uploadsPrefix}${file.filename}`;
    return this.auth.updateMe(req.user.userId, { avatarUrl });
  }

  // ─── Инвайты ───────────────────────────────────────────────────────────────

  /** Инфо об инвайте (публично — для страницы принятия) */
  @Get('invite/:token')
  getInvite(@Param('token') token: string) {
    return this.team.getInviteByToken(token);
  }

  /** Регистрация через инвайт (новый пользователь) */
  @Post('invite/:token/register')
  async registerViaInvite(
    @Param('token') token: string,
    @Body() dto: RegisterDto,
  ) {
    return this.auth.registerViaInvite(token, dto.email, dto.password, this.team);
  }

  /** Войти через инвайт (существующий пользователь) */
  @Post('invite/:token/login')
  async loginViaInvite(
    @Param('token') token: string,
    @Body() dto: LoginDto,
  ) {
    return this.auth.loginViaInvite(token, dto.email, dto.password, this.team);
  }
}
