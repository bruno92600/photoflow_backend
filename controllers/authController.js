const User = require("../models/userModel");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");
const generateOtp = require("../utils/generateOtp");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
const hbs = require("hbs");
const sendEmail = require("../utils/email");
const { title } = require("process");

const loadTemplate = (templateName, replacements) => {
  const templatePath = path.join(__dirname, "../emailTemplate", templateName);
  const source = fs.readFileSync(templatePath, "utf-8");
  const template = hbs.compile(source);
  return template(replacements);
};

const signToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

const createSendToken = (user, statusCode, res, message) => {
  const token = signToken(user._id);
  const cookieOptions = {
    expires: new Date(
      Date.now() + process.env.JWT_COOKIE_EXPIRES_IN * 24 * 60 * 60 * 1000
    ),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    samSite: process.env.NODE_ENV === "production" ? "none" : "Lax",
  };
  res.cookie("token", token, cookieOptions);
  user.password = undefined;
  user.otp = undefined;
  res.status(statusCode).json({
    status: "success",
    message,
    token,
    data: {
      user,
    },
  });
};

exports.signup = catchAsync(async (req, res, next) => {
  const { email, password, passwordConfirm, username } = req.body;
  const existingUser = await User.findOne({ email });

  if (existingUser) {
    return next(new AppError("Cette adresse email est déjà utilisée!", 400));
  }
  const otp = generateOtp();
  const otpExpires = Date.now() + 24 * 60 * 60 * 1000;
  const newUser = await User.create({
    username,
    email,
    password,
    passwordConfirm,
    otp,
    otpExpires,
  });

  const htmlTemplate = loadTemplate("otpTemplate.hbs", {
    title: "Otp Verification",
    username: newUser.username,
    otp,
    message:
      "Votre mot de passe à usage unique (OTP) pour la vérification du compte est : ",
  });

  try {
    await sendEmail({
      email: newUser.email,
      subject: "Verification de compte",
      html: htmlTemplate,
    });

    createSendToken(
      newUser,
      200,
      res,
      "Inscription réussie. Regardez vos email pour vérification"
    );
  } catch (error) {
    await User.findByIdAndDelete(newUser.id);
    return next(
      new AppError(
        "Une erreur s'est produite lors de la création du compte. Veuillez réessayer plus tard! ",
        500
      )
    );
  }
});

exports.verifyAccount = catchAsync(async (req, res, next) => {
  const { otp } = req.body;
  if (!otp) {
    return next(new AppError("Otp est requis pour la vérification", 400));
  }

  const user = req.user;
  if (user.otp !== otp) {
    return next(new AppError("OTP incorrect", 400));
  }
  if (Date.now() > user.otpExpires) {
    return next(
      new AppError("Votre OTP a expiré. Veuillez demander un nouvel OTP", 400)
    );
  }

  user.isVerified = true;
  user.otp = undefined;
  user.otpExpires = undefined;

  await user.save({ validateBeforeSave: false });

  createSendToken(
    user,
    200,
    res,
    "Votre compte est maintenant activé! Vous pouvez vous connecter à votre compte"
  );
});

exports.resendOtp = catchAsync(async (req, res, next) => {
  const { email } = req.user;
  if (!email) {
    return next(
      new AppError("L'adresse email est requise pour ré-envoyer l'OTP", 400)
    );
  }

  const user = await User.findOne({ email });
  if (!user) {
    return next(new AppError("Cette adresse email n'existe pas!", 404));
  }
  if (user.isVerified) {
    return next(new AppError("Votre compte est déjà activé!", 400));
  }

  const otp = generateOtp();
  const otpExpires = Date.now() + 24 * 60 * 60 * 1000;
  user.otp = otp;
  user.otpExpires = otpExpires;

  await user.save({ validateBeforeSave: false });

  const htmlTemplate = loadTemplate("otpTemplate.hbs", {
    title: "Otp Verification",
    username: user.username,
    otp,
    message:
      "Votre mot de passe à usage unique (OTP) pour la vérification du compte est : ",
  });

  try {
    await sendEmail({
      email: user.email,
      subject: "Ré-envoyer otp pour verification par mail",
      html: htmlTemplate,
    });

    res.status(200).json({
      status: "success",
      message: "Nouvel OTP a été envoyé à votre adresse email",
    });
  } catch (error) {
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save({ validateBeforeSave: false });
    return next(
      new AppError(
        "Il y a une erreur lors de l'envoi de l'e-mail. Rééessayez plus tard!",
        500
      )
    );
  }
});

exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return next(
      new AppError("Veuillez renseigner votre email et mot de passe", 400)
    );
  }

  const user = await User.findOne({ email }).select("+password");
  if (!user || !(await user.correctPassword(password, user.password))) {
    return next(new AppError("Email ou mot de passe incorrect", 401));
  }

  createSendToken(user, 200, res, "Connexion réussie");
});

exports.logout = catchAsync(async (req, res, next) => {
  res.cookie("token", "loggedout", {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });

  res.status(200).json({
    status: "success",
    message: "Déconnexion réussie",
  });
});

exports.forgetPassword = catchAsync(async (req, res, next) => {
  const { email } = req.body;
  const user = await User.findOne({ email });
  if (!user) {
    return next(new AppError("Aucun utilisateur trouvé", 404));
  }

  const otp = generateOtp();
  const resetExpires = Date.now() + 300000; // 5min
  user.resetPasswordOtp = otp;
  user.resetPasswordOtpExpires = resetExpires;

  await user.save({ validateBeforeSave: false });

  const htmlTemplate = loadTemplate("otpTemplate.hbs", {
    title: "Réinitialiser le mot de passe OTP",
    username: user.username,
    otp,
    message: "Votre otp de réinitialisation de mot de passe est ",
  });

  try {
    await sendEmail({
      email: user.email,
      subject: "Réinitialisation du mot de passe (Valable 5min)",
      html: htmlTemplate,
    });

    res.status(200).json({
      status: "success",
      message:
        "Un OTP de réinitialisation de mot de passe a été envoyé à votre adresse email",
    });
  } catch (error) {
    user.resetPasswordOtp = undefined;
    user.resetPasswordOtpExpires = undefined;
    await user.save({ validateBeforeSave: false });
    return next(
      new AppError(
        "Il y a une erreur lors de l'envoi de l'e-mail. Réessayez plus tard!",
        500
      )
    );
  }
});

exports.resetPassword = catchAsync(async (req, res, next) => {
  const { email, otp, password, passwordConfirm } = req.body;
  const user = await User.findOne({
    email,
    resetPasswordOtp: otp,
    resetPasswordOtpExpires: { $gt: Date.now() },
  });
  if (!user) {
    return next(new AppError("Aucun utilisateur trouvé", 400));
  }

  user.password = password;
  user.passwordConfirm = passwordConfirm;
  user.resetPasswordOtp = undefined;
  user.resetPasswordOtpExpires = undefined;

  await user.save();
  createSendToken(user, 200, res, "Réinitialisation du mot de passe réussie");
});

exports.changePassword = catchAsync(async (req, res, next) => {
  const { currentPassword, newPassword, newPasswordConfirm } = req.body;
  const { email } = req.user;
  const user = await User.findOne({ email }).select("+password");
  if (!user) {
    return next(new AppError("Aucun utilisateur trouvé", 404));
  }
  if (!(await user.correctPassword(currentPassword, user.password))) {
    return next(new AppError("Mot de passe actuel incorrect", 400));
  }
  if (newPassword !== newPasswordConfirm) {
    return next(
      new AppError("Les nouveaux mots de passe ne sont pas identiques", 400)
    );
  }

  user.password = newPassword;
  user.passwordConfirm = newPasswordConfirm;

  await user.save();

  createSendToken(user, 200, res, "Mot de passe changé avec succès");
});
