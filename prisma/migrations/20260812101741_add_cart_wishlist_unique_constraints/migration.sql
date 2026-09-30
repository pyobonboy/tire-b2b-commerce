CREATE UNIQUE INDEX "CartItem_userId_tireId_key" ON "CartItem"("userId", "tireId");
CREATE UNIQUE INDEX "WishlistEntry_userId_code_key" ON "WishlistEntry"("userId", "code");
