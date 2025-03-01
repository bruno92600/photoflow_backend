const User = require("../models/userModel");
const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");
const { uploadToCloudinary } = require("../utils/cloudinary");
const getDataUri = require("../utils/datauri");

exports.getProfile = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const user = await User.findById(id)
    .select(
      "-password -otp -otpExpires -resetPasswordOtp -resetPasswordOtpExpires -passwordConfirm"
    )
    .populate({
      path: "posts",
      options: { sort: { createdAt: -1 } },
    })
    .populate({
      path: "savedPosts",
      options: { sort: { createdAt: -1 } },
    });

  if (!user) {
    return next(new AppError("Utilisateur non trouvé", 404));
  }

  res.status(200).json({
    status: "success",
    data: { user },
  });
});

exports.editProfile = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { bio } = req.body;
  const profilePicture = req.file;

  let cloudResponse;

  if (profilePicture) {
    const fileUri = getDataUri(profilePicture);
    cloudResponse = await uploadToCloudinary(fileUri);
  }

  const user = await User.findById(userId).select("-password");
  if (!user) return next(new AppError("utilisateur introuvable", 404));

  if (bio) user.bio = bio;
  if (profilePicture) user.profilePicture = cloudResponse.secure_url;

  await user.save({ validateBeforeSave: false });

  return res.status(200).json({
    status: "success",
    message: "Profil mis à jour avec succès",
    data: { user },
  });
});

exports.suggestedUser = catchAsync(async (req, res, next) => {
  const loginUserId = req.user.id;
  const users = await User.find({ _id: { $ne: loginUserId } }).select(
    "-password -otp -otpExpires -resetPasswordOtp -resetPasswordOtpExpires -passwordConfirm"
  );

  res.status(200).json({
    status: "success",
    data: { users },
  });
});

exports.followUnfollow = catchAsync(async (req, res, next) => {
  const loginUserId = req.user._id;
  const targetUserId = req.params.id;
  if (loginUserId.toString === targetUserId) {
    return next(new AppError("Vous ne pouvez pas vous suivre vous-même", 400));
  }

  const targetUser = await User.findById(targetUserId);
  if (!targetUser) {
    return next(new AppError("Utilisateur introuvable", 404));
  }

  const isFollowing = targetUser.followers.includes(loginUserId);
  if (isFollowing) {
    await Promise.all([
      User.updateOne(
        { _id: loginUserId },
        { $pull: { following: targetUserId } }
      ),
      User.updateOne(
        { _id: targetUserId },
        { $pull: { followers: loginUserId } }
      ),
    ]);
  } else {
    await Promise.all([
      User.updateOne(
        { _id: loginUserId },
        { $addToSet: { following: targetUserId } }
      ),
      User.updateOne(
        { _id: targetUserId },
        { $addToSet: { followers: loginUserId } }
      ),
    ]);
  }

  const updatedLoggedInUser = await User.findById(loginUserId).select(
    "-password"
  );

  res.status(200).json({
    message: isFollowing
      ? "N'a plus été suivi avec succès"
      : "Suivi avec succès",
    status: "success",
    data: { user: updatedLoggedInUser },
  });
});

exports.getMe = catchAsync(async (req, res, next) => {
  const user = req.user;
  if (!user) return next(new AppError("Utilisateur non authentifier", 404));

  res.status(200).json({
    status: "success",
    message: "Utilisateur authentifié",
    data: { user },
  });
});
