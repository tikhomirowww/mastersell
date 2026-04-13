import { IsEmail, IsString, IsOptional, MinLength, MaxLength, Matches } from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: 'Неверный формат email' })
  email: string;

  @IsString()
  @MinLength(8, { message: 'Пароль минимум 8 символов' })
  @MaxLength(72)
  @Matches(/[A-Z]/, { message: 'Пароль должен содержать хотя бы одну заглавную букву' })
  @Matches(/[0-9]/, { message: 'Пароль должен содержать хотя бы одну цифру' })
  password: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  tenantName?: string;
}

export class LoginDto {
  @IsEmail({}, { message: 'Неверный формат email' })
  email: string;

  @IsString()
  @MinLength(1)
  password: string;
}
