import User from "../../models/User.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { AppError } from "../../middleware/errorMiddleware.js";

export const getUsers = asyncHandler(async (req, res) => {
const users = await User.find({})
.sort({ createdAt: -1 })
.select("-password");

res.status(200).json({
success: true,
data: {
users,
},
message: "Users fetched successfully",
});
});

export const getUserById = asyncHandler(
async (req, res) => {
const user =
await User.findById(
req.params.id
).select("-password");


if (!user) {
  throw new AppError(
    "User not found",
    404
  );
}

res.status(200).json({
  success: true,
  data: user,
});


}
);

export const updateUser = asyncHandler(
async (req, res) => {


const allowedUpdates = [
  "name",
  "email",
  "isActive",
  "patientProfile",
];

const updates = {};

allowedUpdates.forEach(
  (field) => {
    if (
      req.body[field] !==
      undefined
    ) {
      updates[field] =
        req.body[field];
    }
  }
);

const user =
  await User.findByIdAndUpdate(
    req.params.id,
    updates,
    {
      new: true,
      runValidators: true,
    }
  ).select("-password");

if (!user) {
  throw new AppError(
    "User not found",
    404
  );
}

res.status(200).json({
  success: true,
  data: user,
  message:
    "User updated successfully",
});

}
);

export const deleteUser = asyncHandler(
async (req, res) => {

const user =
  await User.findByIdAndDelete(
    req.params.id
  );

if (!user) {
  throw new AppError(
    "User not found",
    404
  );
}

res.status(200).json({
  success: true,
  message:
    "User deleted successfully",
});

}
);

export const toggleUserStatus =
asyncHandler(
async (req, res) => {

  const user =
    await User.findById(
      req.params.id
    );

  if (!user) {
    throw new AppError(
      "User not found",
      404
    );
  }

  user.isActive =
    !user.isActive;

  await user.save();

  res.status(200).json({
    success: true,
    data: user,
    message:
      user.isActive
        ? "User activated"
        : "User deactivated",
  });
}

);
