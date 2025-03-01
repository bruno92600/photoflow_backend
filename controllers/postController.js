const AppError = require("../utils/appError");
const catchAsync = require("../utils/catchAsync");
const sharp = require("sharp");
const Post = require("../models/postModel");
const User = require("../models/userModel");
const Comment = require("../models/commentModel");
const { uploadToCloudinary, cloudinary } = require("../utils/cloudinary");

exports.createPost = catchAsync(async (req, res, next) => {
  const { caption } = req.body;
  const image = req.file;
  const userId = req.user._id;

  if (!image)
    return next(new AppError("L'image est requise pour le message", 400));

  // optimize our image
  const optimizedImageBuffer = await sharp(image.buffer)
    .resize({
      width: 800,
      height: 800,
      fit: "inside",
    })
    .toFormat("jpeg", { quality: 80 })
    .toBuffer();

  const fileUri = `data:image/jpeg;base64,${optimizedImageBuffer.toString(
    "base64"
  )}`;

  const cloudResponse = await uploadToCloudinary(fileUri);

  let post = await Post.create({
    caption,
    image: {
      url: cloudResponse.secure_url,
      publicId: cloudResponse.public_id,
    },
    user: userId,
  });

  // add post to users posts
  const user = await User.findById(userId);
  if (user) {
    user.posts.push(post.id);
    await user.save({ validateBeforeSave: false });
  }

  post = await post.populate({
    path: "user",
    select: "username email bio profilePicture",
  });

  return res.status(201).json({
    status: "success",
    message: "Post créé avec succès",
    data: { post },
  });
});

exports.getAllPost = catchAsync(async (req, res, next) => {
  const posts = await Post.find()
    .populate({
      path: "user",
      select: "username bio profilePicture",
    })
    .populate({
      path: "comments",
      select: "text user",
      populate: {
        path: "user",
        select: "username profilePicture",
      },
    })
    .sort({ createdAt: -1 });

  return res.status(200).json({
    status: "success",
    results: posts.length,
    data: { posts },
  });
});

exports.getUserPosts = catchAsync(async (req, res, next) => {
  const userId = req.params.id;
  const posts = await Post.find({ user: userId })
    .populate({
      path: "comments",
      select: "text user",
      populate: {
        path: "user",
        select: "username profilePicture",
      },
    })
    .sort({ createdAt: -1 });

  return res.status(200).json({
    status: "success",
    results: posts.length,
    data: { posts },
  });
});

exports.saveOrUnsavePost = catchAsync(async (req, res, next) => {
  const userId = req.user._id;
  const postId = req.params.postId;
  const user = await User.findById(userId);
  if (!user) return next(new AppError("Utilisateur introuvable", 404));

  const isPostSave = user.savedPosts.includes(postId);
  if (isPostSave) {
    user.savedPosts.pull(postId);
    await user.save({ validateBeforeSave: false });
    return res.status(200).json({
      status: "success",
      message: "Publication non enregistrée avec succès",
      data: { user },
    });
  } else {
    user.savedPosts.push(postId);
    await user.save({ validateBeforeSave: false });
    return res.status(200).json({
      status: "success",
      message: "Publication enregistrée avec succès",
      data: { user },
    });
  }
});

exports.deletePost = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;
  const post = await Post.findById(id).populate("user");
  if (!post) {
    return next(new AppError("Publication introuvable", 404));
  }
  if (post.user._id.toString() !== userId.toString()) {
    return next(
      new AppError("Vous ne pouvez supprimer que vos propres publications", 403)
    );
  }

  // remove the post from user posts
  await User.updateOne({ _id: userId }, { $pull: { posts: id } });

  // remove the post from users save list
  await User.updateMany({ savedPosts: id }, { $pull: { savedPosts: id } });

  // remove the comment of this post
  await Comment.deleteMany({ post: id });

  // remove image from cloudinary
  if (post.image.publicId) {
    await cloudinary.uploader.destroy(post.image.publicId);
  }

  // remove the post
  await Post.findByIdAndDelete(id);

  res.status(200).json({
    status: "success",
    message: "Publication supprimée avec succès",
  });
});

exports.likeOrDislikePost = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;
  const post = await Post.findById(id);
  if (!post) {
    return next(new AppError("Publication introuvable", 404));
  }

  const isLiked = post.likes.includes(userId);
  if (isLiked) {
    await Post.findByIdAndUpdate(
      id,
      { $pull: { likes: userId } },
      { new: true }
    );

    return res.status(200).json({
      status: "success",
      message: "J'aime ce post enlevé avec succès",
    });
  } else {
    await Post.findByIdAndUpdate(
      id,
      { $addToSet: { likes: userId } },
      { new: true }
    );
    return res.status(200).json({
      status: "success",
      message: "J'aime ce post avec succès",
    });
  }
});

exports.addComment = catchAsync(async (req, res, next) => {
  const { id: postId } = req.params;
  const userId = req.user._id;
  const { text } = req.body;
  const post = await Post.findById(postId);
  if (!post) {
    return next(new AppError("Publication introuvable", 404));
  }

  if (!text) {
    return next(new AppError("Le commentaire ne peut être vide", 400));
  }

  const comment = await Comment.create({
    text,
    user: userId,
    createdAt: Date.now(),
  });

  post.comments.push(comment);
  await post.save({ validateBeforeSave: false });

  await comment.populate({
    path: "user",
    select: "username profilePicture bio",
  });

  return res.status(201).json({
    status: "success",
    message: "Commentaire créé avec succès",
    data: { comment },
  });
});
